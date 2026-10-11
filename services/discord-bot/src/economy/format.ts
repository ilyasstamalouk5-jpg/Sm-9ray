import type { EconomyConfig } from "./economy-config.js";

type Money = Pick<EconomyConfig, "currencySymbol" | "currencyEmoji">;

/** 1000 -> "1,000 DH" */
export function formatDh(amount: number, config: Money): string {
  return `${Math.trunc(amount).toLocaleString("en-US")} ${config.currencySymbol}`;
}

/** 1000 -> "🪙 1,000 DH" */
export function formatDhWithEmoji(amount: number, config: Money): string {
  return `${config.currencyEmoji} ${formatDh(amount, config)}`;
}

/** Discord timestamp that shows a live "in 3 hours" style countdown. */
export function relativeTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export function fullTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:f>`;
}
