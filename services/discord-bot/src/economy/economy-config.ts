// All economy settings. Every value has the agreed default built in, and every
// value can be overridden with an environment variable. This file has no
// dependencies so it can be tested on its own.

export type EconomyConfig = {
  /** The one Discord server this bot serves. Required at startup. */
  guildId: string | undefined;
  /** Optional role that may use /economy-admin besides Administrators. */
  adminRoleId: string | undefined;
  currencyName: string;
  currencyNamePlural: string;
  currencySymbol: string;
  currencyEmoji: string;
  /** Fallback image from the environment; an admin-saved image wins. */
  currencyImageUrl: string | undefined;
  startingBalance: number;
  voiceRewardAmount: number;
  voiceRewardIntervalMinutes: number;
  voiceRewardCheckIntervalMs: number;
  workRewardAmount: number;
  workCooldownHours: number;
  dailyRewardAmount: number;
  dailyCooldownHours: number;
  minBet: number;
  maxBet: number;
  /** Largest amount any single game can ever pay out. */
  maxGamePayout: number;
  /** Coinflip total return as a percent of the wager (195 = 1.95x). */
  coinflipPayoutPercent: number;
  minesDefaultCount: number;
  minesMaxCount: number;
  minesHouseEdgePercent: number;
  appleTowerLevels: number;
  appleTowerHouseEdgePercent: number;
  /** Natural blackjack profit as a percent of the wager (150 = 3:2). */
  blackjackNaturalPayoutPercent: number;
  blackjackDealerHitsSoft17: boolean;
  /** Minutes of inactivity before an unfinished game is auto-resolved. */
  gameTimeoutMinutes: number;
  /** Guessing games (flag, map, logo): reward range, in DH, by answer speed. */
  quizMinReward: number;
  quizMaxReward: number;
  /** Seconds a player has to answer. A late answer pays nothing. */
  quizTimeLimitSeconds: number;
  /** Seconds before the same player can start another round of the same quiz. */
  quizCooldownSeconds: number;
  /** /pay: share of each transfer that is removed from the economy (2 = 2%). */
  payTaxPercent: number;
  /** /pay: smallest and largest amount one transfer can send (before tax). */
  payMinAmount: number;
  payMaxAmount: number;
  /** Channel for milestone announcements. Empty = no announcements. */
  milestoneAnnounceChannelId: string | undefined;
  /** Emoji in front of each line of the milestone announcement. */
  milestoneBullet: string;
};

type Env = Record<string, string | undefined>;

function readInt(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be a whole number.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return value;
}

function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["true", "1", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(raw)) {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function readText(env: Env, name: string, fallback: string, max = 32): string {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  if (raw.length > max) {
    throw new Error(`${name} must be at most ${max} characters.`);
  }
  return raw;
}

export function loadEconomyConfig(env: Env): EconomyConfig {
  const currencyName = readText(env, "CURRENCY_NAME", "Dirham");
  const config: EconomyConfig = {
    guildId: env.TARGET_GUILD_ID?.trim() || undefined,
    adminRoleId: env.ADMIN_ROLE_ID?.trim() || undefined,
    currencyName,
    currencyNamePlural: readText(
      env,
      "CURRENCY_NAME_PLURAL",
      currencyName === "Dirham" ? "Dirhams" : `${currencyName}s`,
    ),
    currencySymbol: readText(env, "CURRENCY_SYMBOL", "DH", 8),
    currencyEmoji: readText(env, "CURRENCY_EMOJI", "🪙", 64),
    currencyImageUrl: env.CURRENCY_IMAGE_URL?.trim() || undefined,
    startingBalance: readInt(env, "STARTING_BALANCE", 0, 0, 1_000_000_000),
    voiceRewardAmount: readInt(env, "VOICE_REWARD_AMOUNT", 50, 0, 1_000_000),
    voiceRewardIntervalMinutes: readInt(
      env,
      "VOICE_REWARD_INTERVAL_MINUTES",
      60,
      1,
      10_080,
    ),
    voiceRewardCheckIntervalMs: readInt(
      env,
      "VOICE_REWARD_CHECK_INTERVAL_MS",
      60_000,
      10_000,
      3_600_000,
    ),
    workRewardAmount: readInt(env, "WORK_REWARD_AMOUNT", 400, 0, 1_000_000),
    workCooldownHours: readInt(env, "WORK_COOLDOWN_HOURS", 4, 1, 8_760),
    dailyRewardAmount: readInt(env, "DAILY_REWARD_AMOUNT", 1000, 0, 1_000_000),
    dailyCooldownHours: readInt(env, "DAILY_COOLDOWN_HOURS", 24, 1, 8_760),
    minBet: readInt(env, "MIN_BET", 10, 1, 1_000_000_000),
    maxBet: readInt(env, "MAX_BET", 10_000, 1, 1_000_000_000),
    maxGamePayout: readInt(env, "MAX_GAME_PAYOUT", 1_000_000, 1, 1_000_000_000),
    coinflipPayoutPercent: readInt(env, "COINFLIP_PAYOUT_PERCENT", 195, 101, 1000),
    minesDefaultCount: readInt(env, "MINES_DEFAULT_COUNT", 3, 1, 19),
    minesMaxCount: readInt(env, "MINES_MAX_COUNT", 10, 1, 19),
    minesHouseEdgePercent: readInt(env, "MINES_HOUSE_EDGE_PERCENT", 3, 0, 50),
    appleTowerLevels: readInt(env, "APPLE_TOWER_LEVELS", 8, 1, 15),
    appleTowerHouseEdgePercent: readInt(
      env,
      "APPLE_TOWER_HOUSE_EDGE_PERCENT",
      3,
      0,
      50,
    ),
    blackjackNaturalPayoutPercent: readInt(
      env,
      "BLACKJACK_NATURAL_PAYOUT_PERCENT",
      150,
      100,
      300,
    ),
    blackjackDealerHitsSoft17: readBool(env, "BLACKJACK_DEALER_HITS_SOFT_17", false),
    gameTimeoutMinutes: readInt(env, "GAME_TIMEOUT_MINUTES", 10, 1, 1_440),
    quizMinReward: readInt(env, "QUIZ_MIN_REWARD", 40, 0, 1_000_000),
    quizMaxReward: readInt(env, "QUIZ_MAX_REWARD", 70, 0, 1_000_000),
    quizTimeLimitSeconds: readInt(env, "QUIZ_TIME_LIMIT_SECONDS", 15, 3, 300),
    quizCooldownSeconds: readInt(env, "QUIZ_COOLDOWN_SECONDS", 30, 0, 86_400),
    payTaxPercent: readInt(env, "PAY_TAX_PERCENT", 5, 0, 50),
    payMinAmount: readInt(env, "PAY_MIN_AMOUNT", 10, 1, 1_000_000_000),
    payMaxAmount: readInt(env, "PAY_MAX_AMOUNT", 100_000, 1, 1_000_000_000),
    milestoneAnnounceChannelId: env.MILESTONE_ANNOUNCE_CHANNEL_ID?.trim() || undefined,
    milestoneBullet: readText(env, "MILESTONE_BULLET", "🏆", 64),
  };
  return config;
}

const SNOWFLAKE = /^\d{15,25}$/;

/**
 * Checks the settings that cannot be validated while loading. Returns a list
 * of human-readable problems (empty when everything is fine). Never includes
 * secret values.
 */
export function validateEconomyConfig(config: EconomyConfig): string[] {
  const problems: string[] = [];
  if (!config.guildId) {
    problems.push(
      "TARGET_GUILD_ID is required. Set it to the ID of your Discord server.",
    );
  } else if (!SNOWFLAKE.test(config.guildId)) {
    problems.push("TARGET_GUILD_ID must be a Discord server ID (digits only).");
  }
  if (config.adminRoleId && !SNOWFLAKE.test(config.adminRoleId)) {
    problems.push("ADMIN_ROLE_ID must be a Discord role ID (digits only).");
  }
  if (
    config.milestoneAnnounceChannelId &&
    !SNOWFLAKE.test(config.milestoneAnnounceChannelId)
  ) {
    problems.push(
      "MILESTONE_ANNOUNCE_CHANNEL_ID must be a Discord channel ID (digits only).",
    );
  }
  if (config.minBet > config.maxBet) {
    problems.push("MIN_BET must not be greater than MAX_BET.");
  }
  if (config.minesDefaultCount > config.minesMaxCount) {
    problems.push("MINES_DEFAULT_COUNT must not be greater than MINES_MAX_COUNT.");
  }
  if (config.payMinAmount > config.payMaxAmount) {
    problems.push("PAY_MIN_AMOUNT must not be greater than PAY_MAX_AMOUNT.");
  }
  if (config.quizMinReward > config.quizMaxReward) {
    problems.push("QUIZ_MIN_REWARD must not be greater than QUIZ_MAX_REWARD.");
  }
  return problems;
}
