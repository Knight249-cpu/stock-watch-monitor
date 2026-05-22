import { TRPCError } from "@trpc/server";
import { callDataApi } from "./_core/dataApi";

export type SupportedCountry = "TH" | "CN" | "US";

export type ResolvedStockQuote = {
  country: SupportedCountry;
  queryText: string;
  symbol: string;
  displayName: string;
  exchangeName: string | null;
  currentPrice: number;
  currency: string | null;
  sourceName: string;
  sourceUrl: string;
  lastPriceAtMs: number;
};

type YahooChartMeta = {
  symbol?: string;
  longName?: string;
  shortName?: string;
  exchangeName?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  currency?: string;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
};

type QuoteCacheEntry = {
  quote: ResolvedStockQuote;
  cachedAtMs: number;
};

const COUNTRY_SOURCE_MAP: Record<SupportedCountry, { sourceName: string; sourceUrl: string; region: string }> = {
  TH: {
    sourceName: "SET",
    sourceUrl: "https://www.set.or.th/th/home",
    region: "TH",
  },
  CN: {
    sourceName: "Investing.com",
    sourceUrl: "https://www.investing.com",
    region: "CN",
  },
  US: {
    sourceName: "NASDAQ",
    sourceUrl: "https://www.nasdaq.com",
    region: "US",
  },
};

const QUOTE_CACHE_TTL_MS = 30_000;
const quoteCache = new Map<string, QuoteCacheEntry>();
const inFlightQuoteRequests = new Map<string, Promise<ResolvedStockQuote | null>>();

function normalizeQuery(query: string) {
  return query.trim().toUpperCase().replace(/\s+/g, "");
}

function getQuoteCacheKey(country: SupportedCountry, symbol: string) {
  return `${country}:${normalizeQuery(symbol)}`;
}

function cloneResolvedQuote(quote: ResolvedStockQuote, queryText: string) {
  return {
    ...quote,
    queryText,
  };
}

function getFreshCachedQuote(country: SupportedCountry, symbol: string) {
  const cacheKey = getQuoteCacheKey(country, symbol);
  const cachedEntry = quoteCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (Date.now() - cachedEntry.cachedAtMs > QUOTE_CACHE_TTL_MS) {
    quoteCache.delete(cacheKey);
    return null;
  }

  return cloneResolvedQuote(cachedEntry.quote, symbol);
}

function storeCachedQuote(country: SupportedCountry, requestSymbol: string, quote: ResolvedStockQuote) {
  const cachedAtMs = Date.now();
  const requestKey = getQuoteCacheKey(country, requestSymbol);
  const resolvedKey = getQuoteCacheKey(country, quote.symbol);
  const cacheEntry: QuoteCacheEntry = {
    quote,
    cachedAtMs,
  };

  quoteCache.set(requestKey, cacheEntry);
  quoteCache.set(resolvedKey, cacheEntry);
}

export function buildSymbolCandidates(country: SupportedCountry, rawQuery: string): string[] {
  const normalized = normalizeQuery(rawQuery);
  if (!normalized) return [];

  if (country === "US") {
    return [normalized];
  }

  if (country === "TH") {
    if (normalized.endsWith(".BK")) return [normalized];
    return [normalized, `${normalized}.BK`];
  }

  if (normalized.includes(".")) {
    return [normalized];
  }

  if (/^\d{6}$/.test(normalized)) {
    if (normalized.startsWith("6") || normalized.startsWith("9")) {
      return [`${normalized}.SS`, `${normalized}.SZ`];
    }
    if (normalized.startsWith("0") || normalized.startsWith("3")) {
      return [`${normalized}.SZ`, `${normalized}.SS`];
    }
  }

  if (/^\d{3,5}$/.test(normalized)) {
    return [`${normalized.padStart(4, "0")}.HK`];
  }

  return [normalized];
}

export function isDataApiUsageExhaustedError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("failed_precondition") && message.includes("usage exhausted");
}

function createUsageExhaustedError(country: SupportedCountry, mode: "search" | "refresh") {
  const source = COUNTRY_SOURCE_MAP[country];
  const actionText = mode === "search" ? "ค้นหา" : "รีเฟรช";
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `ไม่สามารถ${actionText}ราคาหุ้นจาก ${source.sourceName} ได้ชั่วคราว เนื่องจากโควต้าการใช้งานข้อมูลหมด กรุณาลองใหม่ภายหลัง`,
  });
}

export function getStockDataErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof TRPCError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

async function fetchQuoteBySymbol(
  country: SupportedCountry,
  symbol: string,
  mode: "search" | "refresh"
): Promise<ResolvedStockQuote | null> {
  const cachedQuote = getFreshCachedQuote(country, symbol);
  if (cachedQuote) {
    return cachedQuote;
  }

  const requestKey = getQuoteCacheKey(country, symbol);
  const existingRequest = inFlightQuoteRequests.get(requestKey);
  if (existingRequest) {
    const sharedQuote = await existingRequest;
    return sharedQuote ? cloneResolvedQuote(sharedQuote, symbol) : null;
  }

  const source = COUNTRY_SOURCE_MAP[country];
  const requestPromise = (async () => {
    let payload: YahooChartResponse;

    try {
      payload = (await callDataApi("YahooFinance/get_stock_chart", {
        query: {
          symbol,
          region: source.region,
          interval: "1d",
          range: "5d",
          includeAdjustedClose: "true",
          events: "div,split",
        },
      })) as YahooChartResponse;
    } catch (error) {
      if (isDataApiUsageExhaustedError(error)) {
        throw createUsageExhaustedError(country, mode);
      }
      throw error;
    }

    const meta = payload?.chart?.result?.[0]?.meta;
    const currentPrice =
      typeof meta?.regularMarketPrice === "number"
        ? meta.regularMarketPrice
        : typeof meta?.chartPreviousClose === "number"
          ? meta.chartPreviousClose
          : typeof meta?.previousClose === "number"
            ? meta.previousClose
            : null;

    if (!meta?.symbol || !currentPrice) {
      return null;
    }

    const resolvedQuote: ResolvedStockQuote = {
      country,
      queryText: symbol,
      symbol: meta.symbol,
      displayName: meta.longName || meta.shortName || meta.symbol,
      exchangeName: meta.exchangeName ?? null,
      currentPrice,
      currency: meta.currency ?? null,
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      lastPriceAtMs: Date.now(),
    };

    storeCachedQuote(country, symbol, resolvedQuote);
    return resolvedQuote;
  })();

  inFlightQuoteRequests.set(requestKey, requestPromise);

  try {
    const quote = await requestPromise;
    return quote ? cloneResolvedQuote(quote, symbol) : null;
  } finally {
    inFlightQuoteRequests.delete(requestKey);
  }
}

export async function resolveStockQuote(country: SupportedCountry, queryText: string): Promise<ResolvedStockQuote> {
  const candidates = buildSymbolCandidates(country, queryText);
  if (candidates.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "กรุณาระบุสัญลักษณ์หุ้นก่อนค้นหา",
    });
  }

  for (const candidate of candidates) {
    try {
      const result = await fetchQuoteBySymbol(country, candidate, "search");
      if (result) {
        return {
          ...result,
          queryText: queryText.trim(),
        };
      }
    } catch (error) {
      if (error instanceof TRPCError && error.code === "TOO_MANY_REQUESTS") {
        throw error;
      }
      continue;
    }
  }

  throw new TRPCError({
    code: "NOT_FOUND",
    message:
      country === "CN"
        ? "ไม่พบหุ้นที่ค้นหา กรุณาลองใช้รหัสหุ้นแบบ 6 หลัก เช่น 600519 หรือระบุ suffix เช่น .SS, .SZ, .HK"
        : country === "TH"
          ? "ไม่พบหุ้นที่ค้นหา กรุณาลองใช้ชื่อย่อหุ้นไทย เช่น PTT หรือ PTT.BK"
          : "ไม่พบหุ้นที่ค้นหา กรุณาลองใช้สัญลักษณ์หุ้นสหรัฐ เช่น AAPL",
  });
}

export async function refreshResolvedStockQuote(input: {
  country: SupportedCountry;
  symbol: string;
  queryText?: string;
}): Promise<ResolvedStockQuote> {
  const result = await fetchQuoteBySymbol(input.country, input.symbol, "refresh");
  if (!result) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `ไม่สามารถอัปเดตราคาของ ${input.symbol} ได้ในขณะนี้`,
    });
  }

  return {
    ...result,
    queryText: input.queryText?.trim() || input.symbol,
  };
}
