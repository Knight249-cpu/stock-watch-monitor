import { describe, expect, it } from "vitest";
import { buildSymbolCandidates } from "./stockData";

describe("stockData.buildSymbolCandidates", () => {
  it("keeps US ticker as uppercase symbol", () => {
    expect(buildSymbolCandidates("US", "aapl")).toEqual(["AAPL"]);
  });

  it("adds .BK suffix for Thai stocks when missing", () => {
    expect(buildSymbolCandidates("TH", "ptt")).toEqual(["PTT", "PTT.BK"]);
  });

  it("maps mainland China 6-digit codes to .SS first when symbol starts with 6", () => {
    expect(buildSymbolCandidates("CN", "600519")).toEqual(["600519.SS", "600519.SZ"]);
  });

  it("maps mainland China 6-digit codes to .SZ first when symbol starts with 0", () => {
    expect(buildSymbolCandidates("CN", "000001")).toEqual(["000001.SZ", "000001.SS"]);
  });

  it("maps Hong Kong style numeric codes to .HK", () => {
    expect(buildSymbolCandidates("CN", "700")).toEqual(["0700.HK"]);
  });
});
