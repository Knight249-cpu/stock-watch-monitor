import { describe, expect, it } from "vitest";

describe("LINE_CHANNEL_ACCESS_TOKEN", () => {
  it("authenticates successfully against the LINE bot info endpoint", async () => {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    expect(token).toBeTruthy();

    const response = await fetch("https://api.line.me/v2/bot/info", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json().catch(() => null);

    expect(response.ok).toBe(true);
    expect(payload).toEqual(
      expect.objectContaining({
        basicId: expect.any(String),
        displayName: expect.any(String),
      })
    );
  }, 20000);
});
