import { and, asc, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  InsertWatchlistItem,
  InsertWatchlistSettings,
  users,
  watchlistItems,
  watchlistSettings,
} from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

function requireDb(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) {
    throw new Error("Database is not available");
  }
  return db;
}

export async function countUsers() {
  const db = requireDb(await getDb());
  const rows = await db.select({ total: count() }).from(users);
  return Number(rows[0]?.total ?? 0);
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by id: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0] ?? undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user by email: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);

  return result[0] ?? undefined;
}

export async function createUser(input: {
  email: string;
  name?: string | null;
  passwordHash: string;
  role?: "user" | "admin";
  createdByAdminId?: number | null;
  isActive?: number;
}) {
  const db = requireDb(await getDb());

  const values: InsertUser = {
    email: normalizeEmail(input.email),
    name: input.name ?? null,
    passwordHash: input.passwordHash,
    role: input.role ?? "user",
    isActive: input.isActive ?? 1,
    createdByAdminId: input.createdByAdminId ?? null,
  };

  await db.insert(users).values(values);

  const created = await getUserByEmail(values.email);
  if (!created) {
    throw new Error("Failed to create user");
  }

  return created;
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = requireDb(await getDb());
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
  return getUserById(id);
}

export async function updateUserLastSignedIn(id: number) {
  const db = requireDb(await getDb());
  const signedInAt = new Date();
  await db.update(users).set({ lastSignedIn: signedInAt }).where(eq(users.id, id));
  return getUserById(id);
}

export async function listUsers() {
  const db = requireDb(await getDb());
  return db.select().from(users).orderBy(asc(users.id));
}

export async function deactivateUser(id: number) {
  const db = requireDb(await getDb());
  await db.update(users).set({ isActive: 0 }).where(eq(users.id, id));
  return getUserById(id);
}

export async function getOrCreateWatchlistSettings(userId: number) {
  const db = requireDb(await getDb());
  const existing = await db
    .select()
    .from(watchlistSettings)
    .where(eq(watchlistSettings.userId, userId))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const nowMs = Date.now();
  const values: InsertWatchlistSettings = {
    userId,
    lineUserId: null,
    lineTargetType: "user",
    alertsEnabled: 1,
    autoRefreshSeconds: 120,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  await db.insert(watchlistSettings).values(values);

  const created = await db
    .select()
    .from(watchlistSettings)
    .where(eq(watchlistSettings.userId, userId))
    .limit(1);

  if (!created[0]) {
    throw new Error("Failed to create watchlist settings");
  }

  return created[0];
}

export async function saveWatchlistSettings(input: {
  userId: number;
  lineUserId: string | null;
  lineTargetType: "user" | "group" | "room";
  alertsEnabled: boolean;
  autoRefreshSeconds: number;
}) {
  const db = requireDb(await getDb());
  const nowMs = Date.now();

  const values: InsertWatchlistSettings = {
    userId: input.userId,
    lineUserId: input.lineUserId,
    lineTargetType: input.lineTargetType,
    alertsEnabled: input.alertsEnabled ? 1 : 0,
    autoRefreshSeconds: input.autoRefreshSeconds,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  await db.insert(watchlistSettings).values(values).onDuplicateKeyUpdate({
    set: {
      lineUserId: input.lineUserId,
      lineTargetType: input.lineTargetType,
      alertsEnabled: input.alertsEnabled ? 1 : 0,
      autoRefreshSeconds: input.autoRefreshSeconds,
      updatedAtMs: nowMs,
    },
  });

  return getOrCreateWatchlistSettings(input.userId);
}

export async function listWatchlistUserIds() {
  const db = requireDb(await getDb());
  const rows = await db
    .select({ userId: watchlistItems.userId })
    .from(watchlistItems)
    .groupBy(watchlistItems.userId)
    .orderBy(asc(watchlistItems.userId));

  return rows.map(row => row.userId);
}

export async function listWatchlistItemsForUser(userId: number) {
  const db = requireDb(await getDb());
  return db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .orderBy(asc(watchlistItems.id));
}

export async function countWatchlistItemsForUser(userId: number) {
  const db = requireDb(await getDb());
  const rows = await db
    .select({ total: count() })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId));

  return Number(rows[0]?.total ?? 0);
}

export async function createWatchlistItem(values: InsertWatchlistItem) {
  const db = requireDb(await getDb());
  await db.insert(watchlistItems).values(values);

  const created = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, values.userId),
        eq(watchlistItems.country, values.country),
        eq(watchlistItems.symbol, values.symbol)
      )
    )
    .limit(1);

  if (!created[0]) {
    throw new Error("Failed to create watchlist item");
  }

  return created[0];
}

export async function updateWatchlistTargets(input: {
  userId: number;
  id: number;
  cutloss: string | null;
  sale: string | null;
}) {
  const db = requireDb(await getDb());
  const nowMs = Date.now();

  await db
    .update(watchlistItems)
    .set({
      cutloss: input.cutloss,
      sale: input.sale,
      updatedAtMs: nowMs,
    })
    .where(and(eq(watchlistItems.userId, input.userId), eq(watchlistItems.id, input.id)));

  const updated = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, input.userId), eq(watchlistItems.id, input.id)))
    .limit(1);

  return updated[0] ?? null;
}

export async function deleteWatchlistItem(input: { userId: number; id: number }) {
  const db = requireDb(await getDb());
  await db
    .delete(watchlistItems)
    .where(and(eq(watchlistItems.userId, input.userId), eq(watchlistItems.id, input.id)));
}

export async function saveWatchlistItemRefresh(input: {
  userId: number;
  id: number;
  currentPrice: string;
  lastPriceAtMs: number;
  lastSignal: "none" | "cutloss" | "sale";
  lastAlertAtMs: number | null;
  lastAlertPrice: string | null;
}) {
  const db = requireDb(await getDb());
  const nowMs = Date.now();

  await db
    .update(watchlistItems)
    .set({
      currentPrice: input.currentPrice,
      lastPriceAtMs: input.lastPriceAtMs,
      lastSignal: input.lastSignal,
      lastAlertAtMs: input.lastAlertAtMs,
      lastAlertPrice: input.lastAlertPrice,
      updatedAtMs: nowMs,
    })
    .where(and(eq(watchlistItems.userId, input.userId), eq(watchlistItems.id, input.id)));
}
