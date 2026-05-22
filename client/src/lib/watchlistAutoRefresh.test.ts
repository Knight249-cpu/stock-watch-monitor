// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openWatchlistStream,
  parseWatchlistStreamError,
  parseWatchlistStreamSnapshot,
} from "./watchlistStream";

const eventSourceState = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  close: vi.fn(),
  instances: [] as Array<{ url: string; options: EventSourceInit | undefined; source: MockEventSource }>,
}));

class MockEventSource {
  url: string;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent<string> | Event) => void>>();

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    eventSourceState.instances.push({
      url,
      options,
      source: this,
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent<string> | Event) => void) {
    eventSourceState.addEventListener(type, listener);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, data?: unknown) {
    const listeners = this.listeners.get(type) ?? [];
    const event = type === "open"
      ? new Event("open")
      : ({ data: JSON.stringify(data) } as MessageEvent<string>);
    listeners.forEach(listener => listener(event));
  }

  close() {
    eventSourceState.close();
  }
}

describe("watchlistStream helper", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
    eventSourceState.addEventListener.mockReset();
    eventSourceState.close.mockReset();
    eventSourceState.instances.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a valid stream snapshot payload", () => {
    const snapshot = parseWatchlistStreamSnapshot(
      JSON.stringify({
        kind: "refresh",
        payload: {
          limit: 50,
          total: 1,
          refreshedAtMs: 1710000001111,
          settings: {
            id: 1,
            lineUserId: "line-user-id",
            lineTargetType: "user",
            alertsEnabled: true,
            autoRefreshSeconds: 120,
            createdAtMs: 1710000000000,
            updatedAtMs: 1710000000000,
            lineTokenConfigured: true,
          },
          items: [],
          notifications: [],
          warnings: [],
          stats: {
            remoteFetchCount: 1,
            cachedCount: 0,
            persistedCount: 1,
            minPriceAgeMs: 30000,
          },
        },
      })
    );

    expect(snapshot.kind).toBe("refresh");
    expect(snapshot.payload.refreshedAtMs).toBe(1710000001111);
  });

  it("throws when the stream snapshot payload shape is invalid", () => {
    expect(() => parseWatchlistStreamSnapshot(JSON.stringify({ kind: "refresh" }))).toThrow(
      /Invalid watchlist stream payload/i
    );
  });

  it("returns a friendly fallback for malformed stream errors", () => {
    expect(parseWatchlistStreamError(JSON.stringify({}))).toMatch(/พยายามเชื่อมต่อใหม่/i);
  });

  it("opens EventSource with credentials, relays snapshots, and closes cleanly", () => {
    const onSnapshot = vi.fn();
    const onStatusChange = vi.fn();
    const onStreamError = vi.fn();

    const closeStream = openWatchlistStream({
      onSnapshot,
      onStatusChange,
      onStreamError,
    });

    const [{ url, options, source }] = eventSourceState.instances;
    expect(url).toBe("/api/watchlist/stream");
    expect(options).toMatchObject({ withCredentials: true });
    expect(onStatusChange).toHaveBeenCalledWith("connecting");

    source.dispatch("open");
    source.dispatch("snapshot", {
      kind: "bootstrap",
      payload: {
        limit: 50,
        total: 1,
        refreshedAtMs: 1710000000000,
        settings: {
          id: 1,
          lineUserId: "line-user-id",
          lineTargetType: "user",
          alertsEnabled: true,
          autoRefreshSeconds: 120,
          createdAtMs: 1710000000000,
          updatedAtMs: 1710000000000,
          lineTokenConfigured: true,
        },
        items: [],
        notifications: [],
        warnings: [],
        stats: {
          remoteFetchCount: 0,
          cachedCount: 0,
          persistedCount: 0,
          minPriceAgeMs: 30000,
        },
      },
    });
    source.dispatch("stream-error", { message: "temporary stream failure" });
    source.onerror?.call(source as unknown as EventSource, new Event("error"));
    closeStream();

    expect(onStatusChange).toHaveBeenCalledWith("open");
    expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ kind: "bootstrap" }));
    expect(onStreamError).toHaveBeenCalledWith("temporary stream failure");
    expect(onStatusChange).toHaveBeenCalledWith("error");
    expect(onStatusChange).toHaveBeenCalledWith("closed");
    expect(eventSourceState.close).toHaveBeenCalledTimes(1);
  });
});
