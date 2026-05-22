import { describe, expect, it, vi, beforeEach } from "vitest";

const dataApiMocks = vi.hoisted(() => ({
  callDataApi: vi.fn(),
}));

vi.mock("./_core/dataApi", () => dataApiMocks);

import { refreshResolvedStockQuote, resolveStockQuote } from "./stockData";

describe("stockData quota exhaustion handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a friendly TOO_MANY_REQUESTS error for search when the data quota is exhausted", async () => {
    dataApiMocks.callDataApi.mockRejectedValue(
      new Error(
        'Data API request failed (400 Bad Request): {"code":"failed_precondition","message":"your account has hit a usage exhausted"}'
      )
    );

    await expect(resolveStockQuote("US", "AAPL")).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("โควต้าการใช้งานข้อมูลหมด"),
    });
  });

  it("returns a friendly TOO_MANY_REQUESTS error for refresh when the data quota is exhausted", async () => {
    dataApiMocks.callDataApi.mockRejectedValue(
      new Error(
        'Data API request failed (400 Bad Request): {"code":"failed_precondition","message":"your account has hit a usage exhausted"}'
      )
    );

    await expect(
      refreshResolvedStockQuote({
        country: "US",
        symbol: "AAPL",
        queryText: "AAPL",
      })
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: expect.stringContaining("โควต้าการใช้งานข้อมูลหมด"),
    });
  });
});
