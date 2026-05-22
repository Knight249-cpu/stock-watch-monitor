import { beforeEach, describe, expect, it, vi } from "vitest";

const dataApiMocks = vi.hoisted(() => ({
  callDataApi: vi.fn(),
}));

vi.mock("./_core/dataApi", () => dataApiMocks);

import { resolveStockQuote } from "./stockData";

describe("stockData source references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses SET labels and URL for Thai stocks", async () => {
    dataApiMocks.callDataApi.mockResolvedValue({
      chart: {
        result: [
          {
            meta: {
              symbol: "PTT.BK",
              longName: "PTT Public Company Limited",
              exchangeName: "SET",
              regularMarketPrice: 32.5,
              currency: "THB",
            },
          },
        ],
      },
    });

    const result = await resolveStockQuote("TH", "PTT");

    expect(result.sourceName).toBe("SET");
    expect(result.sourceUrl).toBe("https://www.set.or.th/th/home");
  });

  it("uses Investing.com labels and URL for China stocks", async () => {
    dataApiMocks.callDataApi.mockResolvedValue({
      chart: {
        result: [
          {
            meta: {
              symbol: "600519.SS",
              longName: "Kweichow Moutai",
              exchangeName: "SSE",
              regularMarketPrice: 1688,
              currency: "CNY",
            },
          },
        ],
      },
    });

    const result = await resolveStockQuote("CN", "600519");

    expect(result.sourceName).toBe("Investing.com");
    expect(result.sourceUrl).toBe("https://www.investing.com");
  });

  it("uses NASDAQ labels and URL for US stocks", async () => {
    dataApiMocks.callDataApi.mockResolvedValue({
      chart: {
        result: [
          {
            meta: {
              symbol: "AAPL",
              longName: "Apple Inc.",
              exchangeName: "NASDAQ",
              regularMarketPrice: 180,
              currency: "USD",
            },
          },
        ],
      },
    });

    const result = await resolveStockQuote("US", "AAPL");

    expect(result.sourceName).toBe("NASDAQ");
    expect(result.sourceUrl).toBe("https://www.nasdaq.com");
  });
});
