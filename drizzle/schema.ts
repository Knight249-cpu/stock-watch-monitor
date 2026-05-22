import {
  bigint,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const watchlistSettings = mysqlTable(
  "watchlistSettings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lineUserId: varchar("lineUserId", { length: 255 }),
    lineTargetType: mysqlEnum("lineTargetType", ["user", "group", "room"])
      .default("user")
      .notNull(),
    alertsEnabled: int("alertsEnabled").default(1).notNull(),
    autoRefreshSeconds: int("autoRefreshSeconds").default(120).notNull(),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updatedAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    userUniqueIdx: uniqueIndex("watchlist_settings_user_unique_idx").on(table.userId),
  })
);

export const watchlistItems = mysqlTable(
  "watchlistItems",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    country: mysqlEnum("country", ["TH", "CN", "US"]).notNull(),
    queryText: varchar("queryText", { length: 128 }).notNull(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    exchangeName: varchar("exchangeName", { length: 64 }),
    sourceName: varchar("sourceName", { length: 64 }).notNull(),
    sourceUrl: varchar("sourceUrl", { length: 512 }).notNull(),
    currency: varchar("currency", { length: 16 }),
    currentPrice: decimal("currentPrice", { precision: 18, scale: 4 })
      .default("0.0000")
      .notNull(),
    cutloss: decimal("cutloss", { precision: 18, scale: 4 }),
    sale: decimal("sale", { precision: 18, scale: 4 }),
    lastPriceAtMs: bigint("lastPriceAtMs", { mode: "number" }),
    lastSignal: mysqlEnum("lastSignal", ["none", "cutloss", "sale"])
      .default("none")
      .notNull(),
    lastAlertAtMs: bigint("lastAlertAtMs", { mode: "number" }),
    lastAlertPrice: decimal("lastAlertPrice", { precision: 18, scale: 4 }),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updatedAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    userSymbolUniqueIdx: uniqueIndex("watchlist_items_user_symbol_unique_idx").on(
      table.userId,
      table.country,
      table.symbol
    ),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export type WatchlistSettings = typeof watchlistSettings.$inferSelect;
export type InsertWatchlistSettings = typeof watchlistSettings.$inferInsert;

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = typeof watchlistItems.$inferInsert;
