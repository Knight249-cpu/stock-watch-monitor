import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  countWatchlistItemsForUser,
  createWatchlistItem,
  deleteWatchlistItem,
  listWatchlistItemsForUser,
  saveWatchlistSettings,
  updateWatchlistTargets,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { resolveStockQuote } from "../stockData";
import {
  formatWatchlistItem,
  formatWatchlistSettings,
  getWatchlistDashboard,
  publishWatchlistSnapshot,
  refreshWatchlistSnapshot,
  numberToDecimalString,
} from "../watchlistRealtime";

const countrySchema = z.enum(["TH", "CN", "US"]);
const lineTargetTypeSchema = z.enum(["user", "group", "room"]);
const WATCHLIST_LIMIT = 50;

export const watchlistRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    return getWatchlistDashboard(ctx.user.id);
  }),

  search: protectedProcedure
    .input(
      z.object({
        country: countrySchema,
        query: z.string().trim().min(1).max(64),
      })
    )
    .query(async ({ input }) => {
      return resolveStockQuote(input.country, input.query);
    }),

  add: protectedProcedure
    .input(
      z.object({
        country: countrySchema,
        query: z.string().trim().min(1).max(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const currentCount = await countWatchlistItemsForUser(ctx.user.id);
      if (currentCount >= WATCHLIST_LIMIT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Watchlist เพิ่มได้สูงสุด 50 รายการ",
        });
      }

      const resolved = await resolveStockQuote(input.country, input.query);
      const nowMs = Date.now();

      try {
        const created = await createWatchlistItem({
          userId: ctx.user.id,
          country: resolved.country,
          queryText: input.query.trim(),
          symbol: resolved.symbol,
          displayName: resolved.displayName,
          exchangeName: resolved.exchangeName,
          sourceName: resolved.sourceName,
          sourceUrl: resolved.sourceUrl,
          currency: resolved.currency,
          currentPrice: resolved.currentPrice.toFixed(4),
          cutloss: null,
          sale: null,
          lastPriceAtMs: resolved.lastPriceAtMs,
          lastSignal: "none",
          lastAlertAtMs: null,
          lastAlertPrice: null,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        });

        await publishWatchlistSnapshot(ctx.user.id, "mutation");
        return formatWatchlistItem(created, currentCount);
      } catch {
        throw new TRPCError({
          code: "CONFLICT",
          message: "หุ้นนี้มีอยู่ใน watchlist แล้ว",
        });
      }
    }),

  updateTargets: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        cutloss: z.number().positive().nullable(),
        sale: z.number().positive().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.cutloss !== null && input.sale !== null && input.cutloss >= input.sale) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "ค่า Cutloss ต้องน้อยกว่าค่า Sale",
        });
      }

      const updated = await updateWatchlistTargets({
        userId: ctx.user.id,
        id: input.id,
        cutloss: numberToDecimalString(input.cutloss),
        sale: numberToDecimalString(input.sale),
      });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "ไม่พบรายการหุ้นที่ต้องการแก้ไข",
        });
      }

      const items = await listWatchlistItemsForUser(ctx.user.id);
      const index = items.findIndex(item => item.id === updated.id);
      await publishWatchlistSnapshot(ctx.user.id, "mutation");
      return formatWatchlistItem(updated, index >= 0 ? index : 0);
    }),

  remove: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await deleteWatchlistItem({ userId: ctx.user.id, id: input.id });
      const items = await listWatchlistItemsForUser(ctx.user.id);
      await publishWatchlistSnapshot(ctx.user.id, "mutation");
      return {
        success: true as const,
        total: items.length,
      };
    }),

  saveSettings: protectedProcedure
    .input(
      z.object({
        lineUserId: z.string().trim().max(255).nullable(),
        lineTargetType: lineTargetTypeSchema,
        alertsEnabled: z.boolean(),
        autoRefreshSeconds: z.number().int().min(15).max(3600),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await saveWatchlistSettings({
        userId: ctx.user.id,
        lineUserId: input.lineUserId,
        lineTargetType: input.lineTargetType,
        alertsEnabled: input.alertsEnabled,
        autoRefreshSeconds: input.autoRefreshSeconds,
      });

      const formattedSettings = formatWatchlistSettings(settings);
      await publishWatchlistSnapshot(ctx.user.id, "mutation");
      return formattedSettings;
    }),

  refresh: protectedProcedure
    .input(
      z
        .object({
          sendAlerts: z.boolean().default(true),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await refreshWatchlistSnapshot({
        userId: ctx.user.id,
        sendAlerts: Boolean(input?.sendAlerts ?? true),
      });
      await publishWatchlistSnapshot(ctx.user.id, "refresh", result);
      return result;
    }),
});
