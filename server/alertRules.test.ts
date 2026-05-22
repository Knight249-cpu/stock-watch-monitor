import { describe, expect, it } from "vitest";
import { determineAlertSignal, shouldSendAlert } from "./alertRules";

describe("alertRules.determineAlertSignal", () => {
  it("returns cutloss when price is less than cutloss", () => {
    expect(
      determineAlertSignal({
        price: 10,
        cutloss: 10.5,
        sale: 12,
      })
    ).toBe("cutloss");
  });

  it("returns cutloss when price is equal to cutloss", () => {
    expect(
      determineAlertSignal({
        price: 10,
        cutloss: 10,
        sale: 15,
      })
    ).toBe("cutloss");
  });

  it("returns sale when price is greater than sale", () => {
    expect(
      determineAlertSignal({
        price: 15.5,
        cutloss: 10,
        sale: 15,
      })
    ).toBe("sale");
  });

  it("returns sale when price is equal to sale", () => {
    expect(
      determineAlertSignal({
        price: 15,
        cutloss: 10,
        sale: 15,
      })
    ).toBe("sale");
  });

  it("returns none when price remains between thresholds", () => {
    expect(
      determineAlertSignal({
        price: 12,
        cutloss: 10,
        sale: 15,
      })
    ).toBe("none");
  });
});

describe("alertRules.shouldSendAlert", () => {
  it("allows sending when signal changes to cutloss and alerts are enabled", () => {
    expect(
      shouldSendAlert({
        nextSignal: "cutloss",
        previousSignal: "none",
        alertsEnabled: true,
        hasLineRecipient: true,
        sendAlerts: true,
      })
    ).toBe(true);
  });

  it("prevents duplicate delivery when the same signal was already sent", () => {
    expect(
      shouldSendAlert({
        nextSignal: "sale",
        previousSignal: "sale",
        alertsEnabled: true,
        hasLineRecipient: true,
        sendAlerts: true,
      })
    ).toBe(false);
  });

  it("prevents sending when line recipient is missing", () => {
    expect(
      shouldSendAlert({
        nextSignal: "sale",
        previousSignal: "none",
        alertsEnabled: true,
        hasLineRecipient: false,
        sendAlerts: true,
      })
    ).toBe(false);
  });
});
