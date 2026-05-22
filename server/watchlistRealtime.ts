import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import {
  getOrCreateWatchlistSettings,
  listWatchlistItemsForUser,
  saveWatchlistItemRefresh,
} from "./db";
import { determineAlertSignal, shouldSendAlert } from "./alertRules";
import { buildLineAlertMessage, sendLineAlert } from "./lineAlerts";
import {
  getStockDataErrorMessage,
  refreshResolvedStockQuote,
  type ResolvedStockQuote,
} from "./stockData";
import { sdk } from "./_core/sdk";

const DEFAULT_AUTO_REFRESH_SECONDS = 120;
const MIN_PRICE_AGE_MS = 30_000;
const WATCHLIST_LIMIT = 50;
const STREAM_RETRY_MS = 3_000;
const STREAM_FALLBACK_DELAY_MS = 15_000;

type WatchlistItemRecord = Awaited<ReturnType<typeof listWatchlistItemsForUser>>[number];
type WatchlistSettingsRecord = Awaited<ReturnType<typeof getOrCreateWatchlistSettings>>;

type RefreshNotification = {
  itemId: number;
  signal: "cutloss" | "sale";
  message: string;
  delivered: boolean;
};

type RefreshWarning = {
  itemId: number | null;
  symbol: string | null;
  message: string;
};

export type WatchlistDashboardItem = {
  id: number;
  order: number;
  country: "TH" | "CN" | "US";
  queryText: string;
  symbol: string;
  displayName: string;
  exchangeName: string | null;
  sourceName: string;
  sourceUrl: string;
  currency: string | null;
  currentPrice: number;
  cutloss: number | null;
  sale: number | null;
  lastPriceAtMs: number | null;
  lastSignal: string;
  lastAlertAtMs: number | null;
  lastAlertPrice: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WatchlistDashboardSettings = {
  id: number;
  lineUserId: string | null;
  lineTargetType: "user" | "group" | "room";
  alertsEnabled: boolean;
  autoRefreshSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
  lineTokenConfigured: boolean;
};

export type WatchlistRefreshStats = {
  remoteFetchCount: number;
  cachedCount: number;
  persistedCount: number;
  minPriceAgeMs: number;
};

export type WatchlistStreamSnapshot = {
  limit: number;
  total: number;
  settings: WatchlistDashboardSettings;
  items: WatchlistDashboardItem[];
  refreshedAtMs: number;
  notifications: RefreshNotification[];
  warnings: RefreshWarning[];
  stats: WatchlistRefreshStats;
};

export type WatchlistStreamEnvelope = {
  kind: "bootstrap" | "mutation" | "refresh";
  payload: WatchlistStreamSnapshot;
};

type WatchlistStreamSession = {
  userId: number;
  clients: Set<Response>;
  timer: NodeJS.Timeout | null;
  inFlightRefresh: Promise<WatchlistStreamSnapshot | null> | null;
};

const streamSessions = new Map<number, WatchlistStreamSession>();

function decimalToNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function numberToDecimalString(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return value.toFixed(4);
}

export function formatWatchlistItem(item: WatchlistItemRecord, index: number): WatchlistDashboardItem {
  return {
    id: item.id,
    order: index + 1,
    country: item.country,
    queryText: item.queryText,
    symbol: item.symbol,
    displayName: item.displayName,
    exchangeName: item.exchangeName,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    currency: item.currency,
    currentPrice: Number(item.currentPrice),
    cutloss: decimalToNumber(item.cutloss),
    sale: decimalToNumber(item.sale),
    lastPriceAtMs: item.lastPriceAtMs,
    lastSignal: item.lastSignal,
    lastAlertAtMs: item.lastAlertAtMs,
    lastAlertPrice: decimalToNumber(item.lastAlertPrice),
    createdAtMs: item.createdAtMs,
    updatedAtMs: item.updatedAtMs,
  };
}

export function formatWatchlistSettings(settings: WatchlistSettingsRecord): WatchlistDashboardSettings {
  return {
    id: settings.id,
    lineUserId: settings.lineUserId,
    lineTargetType: settings.lineTargetType,
    alertsEnabled: settings.alertsEnabled === 1,
    autoRefreshSeconds: settings.autoRefreshSeconds || DEFAULT_AUTO_REFRESH_SECONDS,
    createdAtMs: settings.createdAtMs,
    updatedAtMs: settings.updatedAtMs,
    lineTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
  };
}

function getLatestPriceAtMs(items: WatchlistDashboardItem[]) {
  return items.reduce<number | null>((latest, item) => {
    if (!item.lastPriceAtMs) return latest;
    return Math.max(latest ?? 0, item.lastPriceAtMs);
  }, null);
}

function buildIdleStats(): WatchlistRefreshStats {
  return {
    remoteFetchCount: 0,
    cachedCount: 0,
    persistedCount: 0,
    minPriceAgeMs: MIN_PRICE_AGE_MS,
  };
}

function getRefreshIntervalMs(autoRefreshSeconds?: number | null) {
  const seconds = typeof autoRefreshSeconds === "number" && autoRefreshSeconds > 0
    ? autoRefreshSeconds
    : DEFAULT_AUTO_REFRESH_SECONDS;
  return seconds * 1000;
}

function buildFreshStoredQuote(item: WatchlistItemRecord): ResolvedStockQuote | null {
  const currentPrice = decimalToNumber(item.currentPrice);
  if (currentPrice === null || currentPrice <= 0 || !item.lastPriceAtMs) {
    return null;
  }

  if (Date.now() - item.lastPriceAtMs > MIN_PRICE_AGE_MS) {
    return null;
  }

  return {
    country: item.country,
    queryText: item.queryText,
    symbol: item.symbol,
    displayName: item.displayName,
    exchangeName: item.exchangeName,
    currentPrice,
    currency: item.currency,
    sourceName: item.sourceName,
    sourceUrl: item.sourceUrl,
    lastPriceAtMs: item.lastPriceAtMs,
  };
}

function getOrCreateStreamSession(userId: number) {
  const existing = streamSessions.get(userId);
  if (existing) {
    return existing;
  }

  const session: WatchlistStreamSession = {
    userId,
    clients: new Set<Response>(),
    timer: null,
    inFlightRefresh: null,
  };

  streamSessions.set(userId, session);
  return session;
}

function cleanupStreamSession(session: WatchlistStreamSession) {
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }

  session.inFlightRefresh = null;
  streamSessions.delete(session.userId);
}

function writeSseEvent<T>(response: Response, event: string, payload: T) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastSnapshot(session: WatchlistStreamSession, envelope: WatchlistStreamEnvelope) {
  for (const client of Array.from(session.clients)) {
    try {
      writeSseEvent(client, "snapshot", envelope);
    } catch {
      session.clients.delete(client);
    }
  }

  if (session.clients.size === 0) {
    cleanupStreamSession(session);
  }
}

function broadcastStreamError(session: WatchlistStreamSession, message: string) {
  for (const client of Array.from(session.clients)) {
    try {
      writeSseEvent(client, "stream-error", {
        message,
        retryMs: STREAM_RETRY_MS,
        timestampMs: Date.now(),
      });
    } catch {
      session.clients.delete(client);
    }
  }

  if (session.clients.size === 0) {
    cleanupStreamSession(session);
  }
}

function scheduleNextRefresh(session: WatchlistStreamSession, delayMs: number) {
  if (session.timer) {
    clearTimeout(session.timer);
  }

  session.timer = setTimeout(async () => {
    session.timer = null;

    if (session.clients.size === 0) {
      cleanupStreamSession(session);
      return;
    }

    if (!session.inFlightRefresh) {
      session.inFlightRefresh = refreshWatchlistSnapshot({
        userId: session.userId,
        sendAlerts: true,
      })
        .then(result => {
          broadcastSnapshot(session, {
            kind: "refresh",
            payload: result,
          });
          return result;
        })
        .catch(async error => {
          const message = getStockDataErrorMessage(
            error,
            "การเชื่อมต่อข้อมูลสดมีปัญหา ระบบจะพยายามเชื่อมต่อใหม่อัตโนมัติ"
          );
          broadcastStreamError(session, message);
          return null;
        })
        .finally(() => {
          session.inFlightRefresh = null;
        });
    }

    const result = await session.inFlightRefresh;
    const nextDelayMs = result
      ? getRefreshIntervalMs(result.settings.autoRefreshSeconds)
      : STREAM_FALLBACK_DELAY_MS;

    if (streamSessions.get(session.userId) === session && session.clients.size > 0) {
      scheduleNextRefresh(session, nextDelayMs);
    }
  }, delayMs);
}

export async function getWatchlistDashboard(userId: number) {
  const [settings, items] = await Promise.all([
    getOrCreateWatchlistSettings(userId),
    listWatchlistItemsForUser(userId),
  ]);

  return {
    limit: WATCHLIST_LIMIT,
    total: items.length,
    settings: formatWatchlistSettings(settings),
    items: items.map(formatWatchlistItem),
  };
}

export async function getWatchlistStreamSnapshot(userId: number): Promise<WatchlistStreamSnapshot> {
  const dashboard = await getWatchlistDashboard(userId);
  return {
    ...dashboard,
    refreshedAtMs: getLatestPriceAtMs(dashboard.items) ?? Date.now(),
    notifications: [],
    warnings: [],
    stats: buildIdleStats(),
  };
}

export async function refreshWatchlistSnapshot(input: {
  userId: number;
  sendAlerts: boolean;
}): Promise<WatchlistStreamSnapshot> {
  const [settings, items] = await Promise.all([
    getOrCreateWatchlistSettings(input.userId),
    listWatchlistItemsForUser(input.userId),
  ]);

  const notifications: RefreshNotification[] = [];
  const warnings: RefreshWarning[] = [];
  let remoteFetchCount = 0;
  let cachedCount = 0;
  let persistedCount = 0;

  for (const item of items) {
    let quote = buildFreshStoredQuote(item);
    const reusedStoredPrice = Boolean(quote);

    if (reusedStoredPrice) {
      cachedCount += 1;
    }

    if (!quote) {
      try {
        remoteFetchCount += 1;
        quote = await refreshResolvedStockQuote({
          country: item.country,
          symbol: item.symbol,
          queryText: item.queryText,
        });
      } catch (error) {
        const message = getStockDataErrorMessage(
          error,
          `ไม่สามารถรีเฟรชราคาของ ${item.symbol} ได้ในขณะนี้`
        );
        warnings.push({
          itemId: item.id,
          symbol: item.symbol,
          message,
        });

        if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS") {
          break;
        }

        continue;
      }
    }

    const price = quote.currentPrice;
    const cutloss = decimalToNumber(item.cutloss);
    const sale = decimalToNumber(item.sale);
    const nextSignal = determineAlertSignal({ price, cutloss, sale });
    const shouldDeliver = shouldSendAlert({
      nextSignal,
      previousSignal: item.lastSignal,
      alertsEnabled: settings.alertsEnabled === 1,
      hasLineRecipient: Boolean(settings.lineUserId),
      sendAlerts: input.sendAlerts,
    });

    let lastAlertAtMs = item.lastAlertAtMs ?? null;
    let lastAlertPrice = item.lastAlertPrice ?? null;

    if (shouldDeliver && settings.lineUserId && nextSignal !== "none") {
      await sendLineAlert({
        lineUserId: settings.lineUserId,
        lineTargetType: settings.lineTargetType,
        stockName: item.displayName,
        stockSymbol: item.symbol,
        signal: nextSignal,
      });

      lastAlertAtMs = Date.now();
      lastAlertPrice = price.toFixed(4);
      notifications.push({
        itemId: item.id,
        signal: nextSignal,
        message: buildLineAlertMessage({
          lineUserId: settings.lineUserId,
          lineTargetType: settings.lineTargetType,
          stockName: item.displayName,
          stockSymbol: item.symbol,
          signal: nextSignal,
        }),
        delivered: true,
      });
    }

    const shouldPersistRefresh =
      !reusedStoredPrice ||
      nextSignal !== item.lastSignal ||
      lastAlertAtMs !== item.lastAlertAtMs ||
      lastAlertPrice !== item.lastAlertPrice;

    if (shouldPersistRefresh) {
      await saveWatchlistItemRefresh({
        userId: input.userId,
        id: item.id,
        currentPrice: price.toFixed(4),
        lastPriceAtMs: quote.lastPriceAtMs,
        lastSignal: nextSignal,
        lastAlertAtMs,
        lastAlertPrice,
      });
      persistedCount += 1;
    }
  }

  const refreshedItems = await listWatchlistItemsForUser(input.userId);
  const formattedItems = refreshedItems.map(formatWatchlistItem);

  return {
    limit: WATCHLIST_LIMIT,
    total: formattedItems.length,
    refreshedAtMs: Date.now(),
    settings: formatWatchlistSettings(settings),
    notifications,
    warnings,
    stats: {
      remoteFetchCount,
      cachedCount,
      persistedCount,
      minPriceAgeMs: MIN_PRICE_AGE_MS,
    },
    items: formattedItems,
  };
}

export async function publishWatchlistSnapshot(
  userId: number,
  kind: Exclude<WatchlistStreamEnvelope["kind"], "bootstrap">,
  payload?: WatchlistStreamSnapshot
) {
  const session = streamSessions.get(userId);
  if (!session || session.clients.size === 0) {
    return;
  }

  const resolvedPayload = payload ?? (await getWatchlistStreamSnapshot(userId));
  broadcastSnapshot(session, {
    kind,
    payload: resolvedPayload,
  });

  if (kind !== "refresh") {
    scheduleNextRefresh(session, getRefreshIntervalMs(resolvedPayload.settings.autoRefreshSeconds));
  }
}

export async function handleWatchlistStreamRequest(request: Request, response: Response) {
  try {
    const user = await sdk.authenticateRequest(request as never);
    const session = getOrCreateStreamSession(user.id);

    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();
    response.write(`retry: ${STREAM_RETRY_MS}\n\n`);

    session.clients.add(response);

    const bootstrapPayload = await getWatchlistStreamSnapshot(user.id);
    writeSseEvent(response, "snapshot", {
      kind: "bootstrap",
      payload: bootstrapPayload,
    } satisfies WatchlistStreamEnvelope);

    if (!session.timer && !session.inFlightRefresh) {
      scheduleNextRefresh(session, getRefreshIntervalMs(bootstrapPayload.settings.autoRefreshSeconds));
    }

    request.on("close", () => {
      session.clients.delete(response);
      if (session.clients.size === 0) {
        cleanupStreamSession(session);
      }
    });
  } catch {
    response.status(401).json({
      message: "Unauthorized",
    });
  }
}
