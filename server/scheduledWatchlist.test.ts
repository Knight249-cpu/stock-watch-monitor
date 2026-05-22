import { beforeEach, describe, expect, it, vi } from "vitest";

const { listWatchlistUserIdsMock, refreshWatchlistSnapshotMock } = vi.hoisted(() => ({
  listWatchlistUserIdsMock: vi.fn(),
  refreshWatchlistSnapshotMock: vi.fn(),
}));

vi.mock("./db", () => ({
  listWatchlistUserIds: listWatchlistUserIdsMock,
}));

vi.mock("./watchlistRealtime", () => ({
  refreshWatchlistSnapshot: refreshWatchlistSnapshotMock,
}));

import { runScheduledWatchlistRefresh } from "./scheduledWatchlist";

describe("scheduledWatchlist.runScheduledWatchlistRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates refresh stats across all watchlist users", async () => {
    listWatchlistUserIdsMock.mockResolvedValue([11, 22]);
    refreshWatchlistSnapshotMock
      .mockResolvedValueOnce({
        stats: {
          remoteFetchCount: 2,
          cachedCount: 1,
          persistedCount: 2,
          minPriceAgeMs: 30_000,
        },
        notifications: [{ itemId: 1, signal: "sale", message: "AAPL Sale", delivered: true }],
        warnings: [],
      })
      .mockResolvedValueOnce({
        stats: {
          remoteFetchCount: 1,
          cachedCount: 3,
          persistedCount: 1,
          minPriceAgeMs: 30_000,
        },
        notifications: [],
        warnings: [{ itemId: 2, symbol: "TSLA", message: "warning" }],
      });

    const result = await runScheduledWatchlistRefresh();

    expect(refreshWatchlistSnapshotMock).toHaveBeenNthCalledWith(1, {
      userId: 11,
      sendAlerts: true,
    });
    expect(refreshWatchlistSnapshotMock).toHaveBeenNthCalledWith(2, {
      userId: 22,
      sendAlerts: true,
    });
    expect(result.userCount).toBe(2);
    expect(result.processedUserCount).toBe(2);
    expect(result.failedUserCount).toBe(0);
    expect(result.remoteFetchCount).toBe(3);
    expect(result.cachedCount).toBe(4);
    expect(result.persistedCount).toBe(3);
    expect(result.notificationsSent).toBe(1);
    expect(result.warnings).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({ userId: 11, ok: true, notificationsSent: 1 }),
      expect.objectContaining({ userId: 22, ok: true, warnings: 1 }),
    ]);
  });

  it("continues processing remaining users when one refresh fails", async () => {
    listWatchlistUserIdsMock.mockResolvedValue([11, 22]);
    refreshWatchlistSnapshotMock
      .mockRejectedValueOnce(new Error("quota reached"))
      .mockResolvedValueOnce({
        stats: {
          remoteFetchCount: 0,
          cachedCount: 2,
          persistedCount: 0,
          minPriceAgeMs: 30_000,
        },
        notifications: [],
        warnings: [],
      });

    const result = await runScheduledWatchlistRefresh();

    expect(result.userCount).toBe(2);
    expect(result.processedUserCount).toBe(1);
    expect(result.failedUserCount).toBe(1);
    expect(result.cachedCount).toBe(2);
    expect(result.warnings).toBe(1);
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        userId: 11,
        ok: false,
        error: expect.stringContaining("quota reached"),
      })
    );
    expect(result.results[1]).toEqual(
      expect.objectContaining({
        userId: 22,
        ok: true,
        cachedCount: 2,
      })
    );
  });
});
