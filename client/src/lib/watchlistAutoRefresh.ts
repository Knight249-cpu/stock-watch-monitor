const MIN_AUTO_REFRESH_GAP_MS = 30_000;

export function canRunAutoRefresh(input: {
  autoRefreshSeconds?: number | null;
  itemCount: number;
  isRefreshing: boolean;
  lastRefreshedAtMs?: number | null;
  minGapMs?: number;
}) {
  const hasValidSettings = Boolean(input.autoRefreshSeconds && input.autoRefreshSeconds > 0);
  const hasEnoughGap =
    input.lastRefreshedAtMs === null ||
    input.lastRefreshedAtMs === undefined ||
    Date.now() - input.lastRefreshedAtMs >= (input.minGapMs ?? MIN_AUTO_REFRESH_GAP_MS);

  return hasValidSettings && input.itemCount > 0 && !input.isRefreshing && hasEnoughGap;
}
