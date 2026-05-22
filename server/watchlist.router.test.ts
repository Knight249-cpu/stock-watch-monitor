import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const dbMocks = vi.hoisted(() => ({
  countWatchlistItemsForUser: vi.fn(),
  createWatchlistItem: vi.fn(),
  deleteWatchlistItem: vi.fn(),
  listWatchlistItemsForUser: vi.fn(),
  saveWatchlistSettings: vi.fn(),
  updateWatchlistTargets: vi.fn(),
}));

const stockDataMocks = vi.hoisted(() => ({
  resolveStockQuote: vi.fn(),
}));

const realtimeMocks = vi.hoisted(() => ({
  formatWatchlistItem: vi.fn(),
  formatWatchlistSettings: vi.fn(),
  getWatchlistDashboard: vi.fn(),
  numberToDecimalString: vi.fn((value: number | null | undefined) =>
    value === null || value === undefined ? null : value.toFixed(4)
  ),
  publishWatchlistSnapshot: vi.fn(),
  refreshWatchlistSnapshot: vi.fn(),
}));

vi.mock("./db", () => dbMocks);
vi.mock("./stockData", () => stockDataMocks);
vi.mock("./watchlistRealtime", () => realtimeMocks);

import { watchlistRouter } from "./routers/watchlist";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 7,
    openId: "user-open-id",
    email: "stock@example.com",
    name: "Stock User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as TrpcContext["res"],
  };
}

function createWatchlistItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 7,
    country: "US",
    queryText: "AAPL",
    symbol: "AAPL",
    displayName: "Apple Inc.",
    exchangeName: "NASDAQ",
    sourceName: "NASDAQ",
    sourceUrl: "https://www.nasdaq.com",
    currency: "USD",
    currentPrice: "180.0000",
    cutloss: "170.0000",
    sale: "190.0000",
    lastPriceAtMs: 1710000000000,
    lastSignal: "none",
    lastAlertAtMs: null,
    lastAlertPrice: null,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    ...overrides,
  };
}

function createFormattedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    order: 1,
    country: "US",
    queryText: "AAPL",
    symbol: "AAPL",
    displayName: "Apple Inc.",
    exchangeName: "NASDAQ",
    sourceName: "NASDAQ",
    sourceUrl: "https://www.nasdaq.com",
    currency: "USD",
    currentPrice: 180,
    cutloss: 170,
    sale: 190,
    lastPriceAtMs: 1710000000000,
    lastSignal: "none",
    lastAlertAtMs: null,
    lastAlertPrice: null,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    ...overrides,
  };
}

function createSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    userId: 7,
    lineUserId: "line-user-id",
    lineTargetType: "user",
    alertsEnabled: 1,
    autoRefreshSeconds: 120,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    ...overrides,
  };
}

function createFormattedSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    lineUserId: "line-user-id",
    lineTargetType: "user",
    alertsEnabled: true,
    autoRefreshSeconds: 120,
    createdAtMs: 1710000000000,
    updatedAtMs: 1710000000000,
    lineTokenConfigured: true,
    ...overrides,
  };
}

describe("watchlistRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeMocks.formatWatchlistItem.mockImplementation((item: ReturnType<typeof createWatchlistItem>, index: number) => ({
      ...createFormattedItem({
        ...item,
        order: index + 1,
        currentPrice: Number(item.currentPrice),
      }),
    }));
    realtimeMocks.formatWatchlistSettings.mockImplementation((settings: ReturnType<typeof createSettings>) => ({
      ...createFormattedSettings({
        id: settings.id,
        lineUserId: settings.lineUserId,
        lineTargetType: settings.lineTargetType,
        alertsEnabled: settings.alertsEnabled === 1,
        autoRefreshSeconds: settings.autoRefreshSeconds,
        createdAtMs: settings.createdAtMs,
        updatedAtMs: settings.updatedAtMs,
      }),
    }));
    realtimeMocks.getWatchlistDashboard.mockResolvedValue({
      limit: 50,
      total: 1,
      settings: createFormattedSettings(),
      items: [createFormattedItem()],
    });
    realtimeMocks.refreshWatchlistSnapshot.mockResolvedValue({
      limit: 50,
      total: 1,
      refreshedAtMs: 1710000001111,
      settings: createFormattedSettings(),
      items: [createFormattedItem({ currentPrice: 181 })],
      notifications: [],
      warnings: [],
      stats: {
        remoteFetchCount: 1,
        cachedCount: 0,
        persistedCount: 1,
        minPriceAgeMs: 30000,
      },
    });
    dbMocks.saveWatchlistSettings.mockResolvedValue(createSettings());
    dbMocks.listWatchlistItemsForUser.mockResolvedValue([createWatchlistItem()]);
    dbMocks.deleteWatchlistItem.mockResolvedValue(undefined);
  });

  it("returns the dashboard payload from the realtime service", async () => {
    const caller = watchlistRouter.createCaller(createAuthContext());
    const result = await caller.dashboard();

    expect(realtimeMocks.getWatchlistDashboard).toHaveBeenCalledWith(7);
    expect(result).toMatchObject({ total: 1, items: [expect.objectContaining({ symbol: "AAPL" })] });
  });

  it("blocks adding more than 50 watchlist items", async () => {
    dbMocks.countWatchlistItemsForUser.mockResolvedValue(50);
    const caller = watchlistRouter.createCaller(createAuthContext());

    await expect(caller.add({ country: "US", query: "AAPL" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Watchlist เพิ่มได้สูงสุด 50 รายการ",
    });
  });

  it("persists a new watchlist stock and publishes a mutation snapshot", async () => {
    dbMocks.countWatchlistItemsForUser.mockResolvedValue(0);
    stockDataMocks.resolveStockQuote.mockResolvedValue({
      country: "US",
      symbol: "AAPL",
      displayName: "Apple Inc.",
      exchangeName: "NASDAQ",
      sourceName: "NASDAQ",
      sourceUrl: "https://www.nasdaq.com",
      currency: "USD",
      currentPrice: 180,
      lastPriceAtMs: 1710000000000,
    });
    dbMocks.createWatchlistItem.mockResolvedValue(createWatchlistItem());

    const caller = watchlistRouter.createCaller(createAuthContext());
    const result = await caller.add({ country: "US", query: "AAPL" });

    expect(dbMocks.createWatchlistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        symbol: "AAPL",
        currentPrice: "180.0000",
      })
    );
    expect(realtimeMocks.publishWatchlistSnapshot).toHaveBeenCalledWith(7, "mutation");
    expect(result).toMatchObject({ symbol: "AAPL", currentPrice: 180, order: 1 });
  });

  it("returns conflict when trying to add a duplicate stock", async () => {
    dbMocks.countWatchlistItemsForUser.mockResolvedValue(0);
    stockDataMocks.resolveStockQuote.mockResolvedValue({
      country: "US",
      symbol: "AAPL",
      displayName: "Apple Inc.",
      exchangeName: "NASDAQ",
      sourceName: "NASDAQ",
      sourceUrl: "https://www.nasdaq.com",
      currency: "USD",
      currentPrice: 180,
      lastPriceAtMs: 1710000000000,
    });
    dbMocks.createWatchlistItem.mockRejectedValue(new Error("duplicate"));

    const caller = watchlistRouter.createCaller(createAuthContext());

    await expect(caller.add({ country: "US", query: "AAPL" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "หุ้นนี้มีอยู่ใน watchlist แล้ว",
    });
    expect(realtimeMocks.publishWatchlistSnapshot).not.toHaveBeenCalled();
  });

  it("updates targets, formats decimals, and publishes a mutation snapshot", async () => {
    dbMocks.updateWatchlistTargets.mockResolvedValue(createWatchlistItem({ cutloss: "165.0000", sale: "195.0000" }));

    const caller = watchlistRouter.createCaller(createAuthContext());
    const result = await caller.updateTargets({ id: 1, cutloss: 165, sale: 195 });

    expect(realtimeMocks.numberToDecimalString).toHaveBeenCalledWith(165);
    expect(realtimeMocks.numberToDecimalString).toHaveBeenCalledWith(195);
    expect(dbMocks.updateWatchlistTargets).toHaveBeenCalledWith({
      userId: 7,
      id: 1,
      cutloss: "165.0000",
      sale: "195.0000",
    });
    expect(realtimeMocks.publishWatchlistSnapshot).toHaveBeenCalledWith(7, "mutation");
    expect(result).toMatchObject({ symbol: "AAPL" });
  });

  it("removes a watchlist item and returns the remaining total", async () => {
    dbMocks.listWatchlistItemsForUser.mockResolvedValue([]);
    const caller = watchlistRouter.createCaller(createAuthContext());
    const result = await caller.remove({ id: 1 });

    expect(dbMocks.deleteWatchlistItem).toHaveBeenCalledWith({ userId: 7, id: 1 });
    expect(realtimeMocks.publishWatchlistSnapshot).toHaveBeenCalledWith(7, "mutation");
    expect(result).toEqual({ success: true, total: 0 });
  });

  it("formats settings and publishes a mutation snapshot after saving configuration", async () => {
    dbMocks.saveWatchlistSettings.mockResolvedValue(createSettings({ autoRefreshSeconds: 300, alertsEnabled: 0 }));
    const caller = watchlistRouter.createCaller(createAuthContext());

    const result = await caller.saveSettings({
      lineUserId: "line-user-id",
      lineTargetType: "user",
      alertsEnabled: false,
      autoRefreshSeconds: 300,
    });

    expect(dbMocks.saveWatchlistSettings).toHaveBeenCalledWith({
      userId: 7,
      lineUserId: "line-user-id",
      lineTargetType: "user",
      alertsEnabled: false,
      autoRefreshSeconds: 300,
    });
    expect(realtimeMocks.publishWatchlistSnapshot).toHaveBeenCalledWith(7, "mutation");
    expect(result).toMatchObject({ autoRefreshSeconds: 300, alertsEnabled: false });
  });

  it("delegates refresh to the realtime service and publishes the returned snapshot", async () => {
    const caller = watchlistRouter.createCaller(createAuthContext());
    const result = await caller.refresh({ sendAlerts: true });

    expect(realtimeMocks.refreshWatchlistSnapshot).toHaveBeenCalledWith({ userId: 7, sendAlerts: true });
    expect(realtimeMocks.publishWatchlistSnapshot).toHaveBeenCalledWith(7, "refresh", result);
    expect(result).toMatchObject({ refreshedAtMs: 1710000001111, stats: expect.objectContaining({ remoteFetchCount: 1 }) });
  });

  it("rejects invalid targets when cutloss is greater than or equal to sale", async () => {
    const caller = watchlistRouter.createCaller(createAuthContext());

    await expect(
      caller.updateTargets({
        id: 1,
        cutloss: 100,
        sale: 100,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "ค่า Cutloss ต้องน้อยกว่าค่า Sale",
    });
  });

  it("propagates search quota exhaustion from the stock resolver", async () => {
    stockDataMocks.resolveStockQuote.mockRejectedValue(
      new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "ไม่สามารถค้นหาราคาหุ้นจาก NASDAQ ได้ชั่วคราว เนื่องจากโควต้าการใช้งานข้อมูลหมด กรุณาลองใหม่ภายหลัง",
      })
    );

    const caller = watchlistRouter.createCaller(createAuthContext());

    await expect(caller.search({ country: "US", query: "AAPL" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("โควต้าการใช้งานข้อมูลหมด"),
    });
  });
});
