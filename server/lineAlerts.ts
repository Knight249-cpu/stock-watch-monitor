import { TRPCError } from "@trpc/server";
import type { AlertSignal } from "./alertRules";
export type LineTargetType = "user" | "group" | "room";

export type LineAlertInput = {
  lineUserId: string;
  lineTargetType: LineTargetType;
  stockName: string;
  stockSymbol: string;
  signal: Exclude<AlertSignal, "none">;
};

export function buildLineAlertMessage(input: LineAlertInput) {
  const signalText = input.signal === "cutloss" ? "Cutloss" : "Sale";
  return `${input.stockName} (${input.stockSymbol}) ${signalText}`;
}

export async function sendLineAlert(input: LineAlertInput) {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";

  if (!channelAccessToken) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN",
    });
  }

  if (!input.lineUserId.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "ยังไม่ได้ตั้งค่า Line recipient ID",
    });
  }

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channelAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.lineUserId,
      messages: [
        {
          type: "text",
          text: buildLineAlertMessage(input),
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: detail || `LINE API error ${response.status}`,
    });
  }

  return {
    delivered: true as const,
    message: buildLineAlertMessage(input),
    targetType: input.lineTargetType,
  };
}
