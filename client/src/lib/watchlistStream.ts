export type WatchlistStreamConnectionState = "connecting" | "open" | "error" | "closed";

export type WatchlistStreamSnapshot = {
  kind: "bootstrap" | "mutation" | "refresh";
  payload: {
    limit: number;
    total: number;
    refreshedAtMs: number;
    settings: {
      id: number;
      lineUserId: string | null;
      lineTargetType: "user" | "group" | "room";
      alertsEnabled: boolean;
      autoRefreshSeconds: number;
      createdAtMs: number;
      updatedAtMs: number;
      lineTokenConfigured: boolean;
    };
    items: Array<{
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
    }>;
    notifications: Array<{
      itemId: number;
      signal: "cutloss" | "sale";
      message: string;
      delivered: boolean;
    }>;
    warnings: Array<{
      itemId: number | null;
      symbol: string | null;
      message: string;
    }>;
    stats: {
      remoteFetchCount: number;
      cachedCount: number;
      persistedCount: number;
      minPriceAgeMs: number;
    };
  };
};

export function parseWatchlistStreamSnapshot(raw: string): WatchlistStreamSnapshot {
  const parsed = JSON.parse(raw) as Partial<WatchlistStreamSnapshot>;
  if (!parsed || typeof parsed !== "object" || !parsed.payload || typeof parsed.payload !== "object") {
    throw new Error("Invalid watchlist stream payload");
  }

  if (parsed.kind !== "bootstrap" && parsed.kind !== "mutation" && parsed.kind !== "refresh") {
    throw new Error("Unknown watchlist stream event kind");
  }

  return parsed as WatchlistStreamSnapshot;
}

export function parseWatchlistStreamError(raw: string) {
  const parsed = JSON.parse(raw) as { message?: string };
  return typeof parsed.message === "string" && parsed.message.trim().length > 0
    ? parsed.message
    : "การเชื่อมต่อข้อมูลสดมีปัญหา ระบบจะพยายามเชื่อมต่อใหม่";
}

export function openWatchlistStream(input: {
  onSnapshot: (snapshot: WatchlistStreamSnapshot) => void;
  onStatusChange?: (status: WatchlistStreamConnectionState) => void;
  onStreamError?: (message: string) => void;
}) {
  input.onStatusChange?.("connecting");

  const source = new EventSource("/api/watchlist/stream", {
    withCredentials: true,
  });

  source.addEventListener("open", () => {
    input.onStatusChange?.("open");
  });

  source.addEventListener("snapshot", event => {
    const messageEvent = event as MessageEvent<string>;
    try {
      input.onSnapshot(parseWatchlistStreamSnapshot(messageEvent.data));
    } catch (error) {
      input.onStatusChange?.("error");
      input.onStreamError?.(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Invalid watchlist stream payload"
      );
    }
  });

  source.addEventListener("stream-error", event => {
    const messageEvent = event as MessageEvent<string>;
    input.onStatusChange?.("error");
    input.onStreamError?.(parseWatchlistStreamError(messageEvent.data));
  });

  source.onerror = () => {
    input.onStatusChange?.("error");
  };

  return () => {
    input.onStatusChange?.("closed");
    source.close();
  };
}
