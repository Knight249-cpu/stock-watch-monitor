import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createUser,
  deactivateUser,
  getUserByEmail,
  getUserById,
  listUsers,
  updateUserLastSignedIn,
  updateUserPassword,
} from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import { watchlistRouter } from "./routers/watchlist";

const passwordSchema = z.string().min(8).max(128);

function toSafeUser(user: Awaited<ReturnType<typeof getUserById>> extends infer T ? Exclude<T, undefined> : never) {
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}

function mapDbErrorToTrpc(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  ) {
    return new TRPCError({
      code: "CONFLICT",
      message: "An account with this email already exists.",
    });
  }

  return error;
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => (opts.ctx.user ? toSafeUser(opts.ctx.user) : null)),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(320),
          password: passwordSchema,
        })
      )
      .mutation(async ({ ctx, input }) => {
        const user = await getUserByEmail(input.email);
        const isValidPassword = user
          ? await sdk.verifyPassword(input.password, user.passwordHash)
          : false;

        if (!user || user.isActive !== 1 || !isValidPassword) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid email or password.",
          });
        }

        const sessionToken = await sdk.createSessionToken(user.id);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });

        const updatedUser = (await updateUserLastSignedIn(user.id)) ?? user;
        return toSafeUser(updatedUser);
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  admin: router({
    listUsers: adminProcedure.query(async () => {
      const rows = await listUsers();
      return rows.map(toSafeUser);
    }),
    createUser: adminProcedure
      .input(
        z.object({
          email: z.string().trim().email().max(320),
          name: z.string().trim().min(1).max(255),
          password: passwordSchema,
          role: z.enum(["user", "admin"]).default("user"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const passwordHash = await sdk.hashPassword(input.password);
          const created = await createUser({
            email: input.email,
            name: input.name,
            passwordHash,
            role: input.role,
            createdByAdminId: ctx.user.id,
          });
          return toSafeUser(created);
        } catch (error) {
          throw mapDbErrorToTrpc(error);
        }
      }),
    resetPassword: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          password: passwordSchema,
        })
      )
      .mutation(async ({ input }) => {
        const existing = await getUserById(input.userId);
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found.",
          });
        }

        const passwordHash = await sdk.hashPassword(input.password);
        const updated = await updateUserPassword(input.userId, passwordHash);
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update password.",
          });
        }

        return toSafeUser(updated);
      }),
    deactivateUser: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.id === input.userId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot deactivate the current signed-in admin account.",
          });
        }

        const existing = await getUserById(input.userId);
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User not found.",
          });
        }

        const updated = await deactivateUser(input.userId);
        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to deactivate user.",
          });
        }

        return toSafeUser(updated);
      }),
  }),
  watchlist: watchlistRouter,
});

export type AppRouter = typeof appRouter;
