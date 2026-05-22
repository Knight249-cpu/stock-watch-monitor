// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setData: vi.fn(),
  invalidate: vi.fn(),
  mutate: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  dashboardUseQuery: vi.fn(),
  searchUseQuery: vi.fn(),
  addUseMutation: vi.fn(),
  removeUseMutation: vi.fn(),
  updateTargetsUseMutation: vi.fn(),
  saveSettingsUseMutation: vi.fn(),
  refreshUseMutation: vi.fn(),
  openWatchlistStream: vi.fn(),
  closeWatchlistStream: vi.fn(),
}));

let latestStreamHandlers: {
  onSnapshot?: (snapshot: any) => void;
  onStatusChange?: (status: "connecting" | "open" | "error" | "closed") => void;
  onStreamError?: (message: string) => void;
} | null = null;

const stableUtils = {
  watchlist: {
    dashboard: {
      setData: mocks.setData,
      invalidate: mocks.invalidate,
    },
  },
};

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardDescription: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode; value: string }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={event => onCheckedChange(event.target.checked)}
      aria-label="switch"
    />
  ),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/watchlistStream", () => ({
  openWatchlistStream: (...args: unknown[]) => mocks.openWatchlistStream(...args),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => stableUtils,
    watchlist: {
      dashboard: {
        useQuery: (...args: unknown[]) => mocks.dashboardUseQuery(...args),
      },
      search: {
        useQuery: (...args: unknown[]) => mocks.searchUseQuery(...args),
      },
      add: {
        useMutation: (...args: unknown[]) => mocks.addUseMutation(...args),
      },
      remove: {
        useMutation: (...args: unknown[]) => mocks.removeUseMutation(...args),
      },
      updateTargets: {
        useMutation: (...args: unknown[]) => mocks.updateTargetsUseMutation(...args),
      },
      saveSettings: {
        useMutation: (...args: unknown[]) => mocks.saveSettingsUseMutation(...args),
      },
      refresh: {
        useMutation: (...args: unknown[]) => mocks.refreshUseMutation(...args),
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

import Home from "./Home";

function createDashboardData() {
  return {
    limit: 50,
    total: 1,
    settings: {
      id: 1,
      lineUserId: "line-user-id",
      lineTargetType: "user" as const,
      alertsEnabled: true,
      autoRefreshSeconds: 120,
      createdAtMs: 1710000000000,
      updatedAtMs: 1710000000000,
      lineTokenConfigured: true,
    },
    items: [
      {
        id: 1,
        order: 1,
        country: "US" as const,
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
        lastSignal: "none" as const,
        lastAlertAtMs: null,
        lastAlertPrice: null,
        createdAtMs: 1710000000000,
        updatedAtMs: 1710000000000,
      },
    ],
  };
}

function createStreamSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    kind: "refresh" as const,
    payload: {
      ...createDashboardData(),
      refreshedAtMs: 1710000001111,
      notifications: [],
      warnings: [],
      stats: {
        remoteFetchCount: 1,
        cachedCount: 0,
        persistedCount: 1,
        minPriceAgeMs: 30000,
      },
      ...overrides,
    },
  };
}

function configureDefaultMocks(options?: {
  dashboardData?: ReturnType<typeof createDashboardData>;
  dashboardError?: Error | null;
  searchData?: unknown;
  searchError?: Error | null;
  refreshError?: Error | null;
  streamStartsOpen?: boolean;
}) {
  latestStreamHandlers = null;

  mocks.dashboardUseQuery.mockReturnValue({
    data: options?.dashboardData ?? createDashboardData(),
    isLoading: false,
    error: options?.dashboardError ?? null,
  });

  mocks.searchUseQuery.mockReturnValue({
    data: options?.searchData,
    isFetching: false,
    error: options?.searchError ?? null,
  });

  mocks.addUseMutation.mockReturnValue({
    isPending: false,
    mutate: mocks.mutate,
  });

  mocks.removeUseMutation.mockReturnValue({
    isPending: false,
    mutate: mocks.mutate,
  });

  mocks.updateTargetsUseMutation.mockReturnValue({
    isPending: false,
    mutate: mocks.mutate,
  });

  mocks.saveSettingsUseMutation.mockReturnValue({
    isPending: false,
    mutate: mocks.mutate,
  });

  mocks.refreshUseMutation.mockReturnValue({
    data: undefined,
    error: options?.refreshError ?? null,
    isPending: false,
    mutate: mocks.mutate,
    mutateAsync: vi.fn(),
  });

  mocks.openWatchlistStream.mockImplementation((handlers: typeof latestStreamHandlers) => {
    latestStreamHandlers = handlers;
    handlers?.onStatusChange?.(options?.streamStartsOpen === false ? "connecting" : "open");
    return mocks.closeWatchlistStream;
  });
}

describe("Home page integration", () => {
  beforeEach(() => {
    cleanup();
    latestStreamHandlers = null;
    mocks.setData.mockReset();
    mocks.invalidate.mockReset();
    mocks.mutate.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.dashboardUseQuery.mockReset();
    mocks.searchUseQuery.mockReset();
    mocks.addUseMutation.mockReset();
    mocks.removeUseMutation.mockReset();
    mocks.updateTargetsUseMutation.mockReset();
    mocks.saveSettingsUseMutation.mockReset();
    mocks.refreshUseMutation.mockReset();
    mocks.openWatchlistStream.mockReset();
    mocks.closeWatchlistStream.mockReset();
    configureDefaultMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("restores watchlist rows and target values from dashboard query after a simulated reload", () => {
    const view = render(<Home />);

    expect(screen.getByText("Apple Inc.")).toBeTruthy();
    expect(screen.getByDisplayValue("170")).toBeTruthy();
    expect(screen.getByDisplayValue("190")).toBeTruthy();

    view.unmount();
    configureDefaultMocks();
    render(<Home />);

    expect(screen.getByText("Apple Inc.")).toBeTruthy();
    expect(screen.getByDisplayValue("170")).toBeTruthy();
    expect(screen.getByDisplayValue("190")).toBeTruthy();
  });

  it("opens the watchlist stream on mount and closes it on unmount", () => {
    const view = render(<Home />);

    expect(mocks.openWatchlistStream).toHaveBeenCalled();
    view.unmount();
    expect(mocks.closeWatchlistStream).toHaveBeenCalled();
  });

  it("updates the dashboard cache and shows live stream status when a snapshot arrives", async () => {
    render(<Home />);

    await act(async () => {
      latestStreamHandlers?.onSnapshot?.(createStreamSnapshot());
    });

    expect(mocks.setData).toHaveBeenCalled();
    expect(screen.getByText(/Live stream/i)).toBeTruthy();
    expect(screen.getByText(/Last refresh:/i)).toBeTruthy();
  });

  it("shows a warning banner when the stream reports partial refresh failures", async () => {
    render(<Home />);

    await act(async () => {
      latestStreamHandlers?.onSnapshot?.(
        createStreamSnapshot({
          warnings: [
            {
              itemId: 1,
              symbol: "AAPL",
              message:
                "ไม่สามารถรีเฟรชราคาหุ้นจาก NASDAQ ได้ชั่วคราว เนื่องจากโควต้าการใช้งานข้อมูลหมด กรุณาลองใหม่ภายหลัง",
            },
          ],
        })
      );
    });

    expect(screen.getByText(/การอัปเดตราคาล่าสุดมีบางรายการอัปเดตไม่ได้/i)).toBeTruthy();
    expect(screen.getByText(/โควต้าการใช้งานข้อมูลหมด/i)).toBeTruthy();
  });

  it("shows a stream error banner when the live connection reports an error", async () => {
    render(<Home />);

    await act(async () => {
      latestStreamHandlers?.onStatusChange?.("error");
      latestStreamHandlers?.onStreamError?.("temporary stream failure");
    });

    expect(screen.getByText(/การอัปเดตข้อมูลล่าสุดมีปัญหา/i)).toBeTruthy();
    expect(screen.getByText(/temporary stream failure/i)).toBeTruthy();
  });

  it("avoids invalidating dashboard query after add succeeds while stream is open", async () => {
    const searchData = {
      country: "US",
      symbol: "AAPL",
      displayName: "Apple Inc.",
      exchangeName: "NASDAQ",
      sourceName: "NASDAQ",
      sourceUrl: "https://www.nasdaq.com",
      currency: "USD",
      currentPrice: 180,
    };
    let addSuccessHandler: (() => Promise<void> | void) | undefined;

    configureDefaultMocks({ searchData });
    mocks.addUseMutation.mockImplementation(({ onSuccess }: { onSuccess?: () => Promise<void> | void }) => {
      addSuccessHandler = onSuccess;
      return {
        isPending: false,
        mutate: () => {
          void onSuccess?.();
        },
      };
    });

    render(<Home />);

    fireEvent.change(screen.getByPlaceholderText(/เช่น PTT, 600519\.SS, AAPL/i), {
      target: { value: "AAPL" },
    });
    fireEvent.click(screen.getByText("ค้นหา"));

    await act(async () => {
      await addSuccessHandler?.();
    });

    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("falls back to invalidating dashboard query when stream is not yet open", async () => {
    let removeSuccessHandler: (() => Promise<void> | void) | undefined;

    configureDefaultMocks({ streamStartsOpen: false });
    mocks.removeUseMutation.mockImplementation(({ onSuccess }: { onSuccess?: () => Promise<void> | void }) => {
      removeSuccessHandler = onSuccess;
      return {
        isPending: false,
        mutate: () => {
          void onSuccess?.();
        },
      };
    });

    render(<Home />);

    await act(async () => {
      await removeSuccessHandler?.();
    });

    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });
});
