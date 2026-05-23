import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  createUser: vi.fn(),
  deactivateUser: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  listUsers: vi.fn(),
  updateUserLastSignedIn: vi.fn(),
  updateUserPassword: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => ({
  createSessionToken: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./_core/sdk", () => ({
  sdk: sdkMocks,
}));

import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

type CookieCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

function createUserMock(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    email: "admin@example.com",
    passwordHash: "hashed-password",
    isActive: 1,
    createdByAdminId: null,
    name: "Admin User",
    role: "admin",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSignedIn: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createContext(user: AuthenticatedUser | null = null) {
  const cookies: CookieCall[] = [];

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookies.push({ name, value, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, cookies };
}

describe("local auth router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signs in with email/password and sets the session cookie", async () => {
    const dbUser = createUserMock({ role: "user", email: "member@example.com" });
    const signedInUser = createUserMock({
      role: "user",
      email: "member@example.com",
      lastSignedIn: new Date("2026-02-01T00:00:00.000Z"),
    });
    const { ctx, cookies } = createContext(null);
    const caller = appRouter.createCaller(ctx);

    dbMocks.getUserByEmail.mockResolvedValue(dbUser);
    sdkMocks.verifyPassword.mockResolvedValue(true);
    sdkMocks.createSessionToken.mockResolvedValue("signed-jwt");
    dbMocks.updateUserLastSignedIn.mockResolvedValue(signedInUser);

    const result = await caller.auth.login({
      email: "member@example.com",
      password: "super-secret",
    });

    expect(result).toMatchObject({
      id: signedInUser.id,
      email: signedInUser.email,
      role: signedInUser.role,
      isActive: 1,
    });
    expect(result).not.toHaveProperty("passwordHash");
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.value).toBe("signed-jwt");
    expect(dbMocks.getUserByEmail).toHaveBeenCalledWith("member@example.com");
    expect(sdkMocks.verifyPassword).toHaveBeenCalledWith("super-secret", "hashed-password");
  });

  it("rejects invalid credentials", async () => {
    const { ctx } = createContext(null);
    const caller = appRouter.createCaller(ctx);

    dbMocks.getUserByEmail.mockResolvedValue(createUserMock({ role: "user" }));
    sdkMocks.verifyPassword.mockResolvedValue(false);

    await expect(
      caller.auth.login({
        email: "member@example.com",
        password: "wrong-password",
      })
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid email or password.",
    } satisfies Partial<TRPCError>);
  });

  it("allows admins to create managed users without exposing password hashes", async () => {
    const { ctx } = createContext(createUserMock());
    const caller = appRouter.createCaller(ctx);
    const createdUser = createUserMock({
      id: 8,
      role: "user",
      email: "new-user@example.com",
      name: "New User",
      createdByAdminId: 1,
    });

    sdkMocks.hashPassword.mockResolvedValue("fresh-hash");
    dbMocks.createUser.mockResolvedValue(createdUser);

    const result = await caller.admin.createUser({
      email: "new-user@example.com",
      name: "New User",
      password: "initial-password",
      role: "user",
    });

    expect(sdkMocks.hashPassword).toHaveBeenCalledWith("initial-password");
    expect(dbMocks.createUser).toHaveBeenCalledWith({
      email: "new-user@example.com",
      name: "New User",
      passwordHash: "fresh-hash",
      role: "user",
      createdByAdminId: 1,
    });
    expect(result).toMatchObject({
      id: 8,
      email: "new-user@example.com",
      role: "user",
    });
    expect(result).not.toHaveProperty("passwordHash");
  });
});
