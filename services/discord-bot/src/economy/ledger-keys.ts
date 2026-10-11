/** Season 1 keeps the original key, so existing voice payouts stay recognised. */
export function voiceRewardKey(
  userId: string,
  checkpoint: number,
  season = 1,
): string {
  return season > 1
    ? `voice:s${season}:${userId}:${checkpoint}`
    : `voice:${userId}:${checkpoint}`;
}
