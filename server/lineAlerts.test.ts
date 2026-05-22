import { describe, expect, it } from "vitest";
import { buildLineAlertMessage } from "./lineAlerts";

describe("lineAlerts.buildLineAlertMessage", () => {
  it("builds the exact Cutloss keyword in the outgoing message", () => {
    expect(
      buildLineAlertMessage({
        lineUserId: "user-123",
        lineTargetType: "user",
        stockName: "PTT Public Company Limited",
        stockSymbol: "PTT.BK",
        signal: "cutloss",
      })
    ).toBe("PTT Public Company Limited (PTT.BK) Cutloss");
  });

  it("builds the exact Sale keyword in the outgoing message", () => {
    expect(
      buildLineAlertMessage({
        lineUserId: "group-456",
        lineTargetType: "group",
        stockName: "Apple Inc.",
        stockSymbol: "AAPL",
        signal: "sale",
      })
    ).toBe("Apple Inc. (AAPL) Sale");
  });
});
