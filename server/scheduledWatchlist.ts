import type { Request, Response } from "express";
import { getStockDataErrorMessage } from "./stockData";
import { listWatchlistUserIds } from "./db";
import { refreshWatchlistSnapshot } from "./watchlistRealtime";

export type ScheduledRefreshUserResult = {
  userId: number;
  remoteFetchCount: number;
  cachedCount: number;
  persistedCount: number;
  notificationsSent: number;
  warnings: number;
  ok: boolean;
  error?: string;
};

export type ScheduledRefreshSummary = {
  startedAtMs: number;
  finishedAtMs: number;
  userCount: number;
  processedUserCount: number;
  failedUserCount: number;
  remoteFetchCount: number;
  cachedCount: number;
  persistedCount: number;
  notificationsSent: number;
  warnings: number;
  results: ScheduledRefreshUserResult[];
};

function getScheduleSecret() {
  return process.env.SCHEDULE_SECRET?.trim() ?? "";
}

function getRequestSecret(request: Request) {
  const authHeader = request.header("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return (
    request.header("x-schedule-secret")
    ?? (typeof request.query.key === "string" ? request.query.key : "")
  ).trim();
}

export function isScheduleRequestAuthorized(request: Request) {
  const configuredSecret = getScheduleSecret();
  if (!configuredSecret) {
    return false;
  }

  return getRequestSecret(request) === configuredSecret;
}

export async function runScheduledWatchlistRefresh(): Promise<ScheduledRefreshSummary> {
  const startedAtMs = Date.now();
  const userIds = await listWatchlistUserIds();
  const results: ScheduledRefreshUserResult[] = [];

  let remoteFetchCount = 0;
  let cachedCount = 0;
  let persistedCount = 0;
  let notificationsSent = 0;
  let warnings = 0;
  let failedUserCount = 0;

  for (const userId of userIds) {
    try {
      const snapshot = await refreshWatchlistSnapshot({
        userId,
        sendAlerts: true,
      });

      remoteFetchCount += snapshot.stats.remoteFetchCount;
      cachedCount += snapshot.stats.cachedCount;
      persistedCount += snapshot.stats.persistedCount;
      notificationsSent += snapshot.notifications.length;
      warnings += snapshot.warnings.length;

      results.push({
        userId,
        remoteFetchCount: snapshot.stats.remoteFetchCount,
        cachedCount: snapshot.stats.cachedCount,
        persistedCount: snapshot.stats.persistedCount,
        notificationsSent: snapshot.notifications.length,
        warnings: snapshot.warnings.length,
        ok: true,
      });
    } catch (error) {
      failedUserCount += 1;
      results.push({
        userId,
        remoteFetchCount: 0,
        cachedCount: 0,
        persistedCount: 0,
        notificationsSent: 0,
        warnings: 1,
        ok: false,
        error: getStockDataErrorMessage(error, `Scheduled refresh failed for user ${userId}`),
      });
      warnings += 1;
    }
  }

  return {
    startedAtMs,
    finishedAtMs: Date.now(),
    userCount: userIds.length,
    processedUserCount: userIds.length - failedUserCount,
    failedUserCount,
    remoteFetchCount,
    cachedCount,
    persistedCount,
    notificationsSent,
    warnings,
    results,
  };
}

export async function handleScheduledWatchlistRefresh(request: Request, response: Response) {
  const configuredSecret = getScheduleSecret();
  if (!configuredSecret) {
    response.status(500).json({
      ok: false,
      error: "SCHEDULE_SECRET is not configured",
    });
    return;
  }

  if (!isScheduleRequestAuthorized(request)) {
    response.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
    return;
  }

  try {
    const summary = await runScheduledWatchlistRefresh();
    response.json({
      ok: true,
      summary,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: getStockDataErrorMessage(error, "Scheduled watchlist refresh failed"),
      timestampMs: Date.now(),
    });
  }
}
