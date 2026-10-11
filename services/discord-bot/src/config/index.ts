import "dotenv/config";
import { GatewayIntentBits } from "discord.js";
import { isValidTimeZone } from "../activity/activity-data.js";
import { loadEconomyConfig } from "../economy/economy-config.js";
import type { MilestoneDefinition } from "../milestones/types.js";

const milestoneSteps = [
  { id: "1", hours: 1 },
  { id: "2", hours: 2 },
  { id: "3", hours: 4 },
  { id: "4", hours: 8 },
  { id: "5", hours: 16 },
  { id: "6", hours: 24 },
  { id: "7", hours: 48 },
  { id: "8", hours: 72 },
  { id: "9", hours: 100 },
  { id: "10", hours: 150 },
] as const;

function optionalNonnegativeInteger(
  value: string | undefined,
  variableName: string,
): number | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${variableName} must be a non-negative integer.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${variableName} must be a safe integer.`);
  }
  return parsed;
}

const milestoneDefinitions: MilestoneDefinition[] = milestoneSteps.map(
  ({ id, hours }) => ({
    id,
    requiredVoiceTimeSeconds: hours * 60 * 60,
    roleId: process.env[`MILESTONE_ROLE_${id}`]?.trim() || null,
    currencyRewardAmount: optionalNonnegativeInteger(
      process.env[`MILESTONE_CURRENCY_REWARD_${id}`],
      `MILESTONE_CURRENCY_REWARD_${id}`,
    ),
  }),
);
const activityTimeZone = process.env.ACTIVITY_TIMEZONE?.trim() || "UTC";
if (!isValidTimeZone(activityTimeZone)) {
  throw new Error(
    "ACTIVITY_TIMEZONE must be a valid IANA time zone name, for example Africa/Casablanca.",
  );
}
const configuredCheckIntervalMs = optionalNonnegativeInteger(
  process.env.MILESTONE_CHECK_INTERVAL_MS,
  "MILESTONE_CHECK_INTERVAL_MS",
);
if (
  configuredCheckIntervalMs !== null &&
  configuredCheckIntervalMs < 10_000
) {
  throw new Error("MILESTONE_CHECK_INTERVAL_MS must be at least 10000.");
}

export const config = {
  discord: {
    token:
      process.env.DISCORD_TOKEN?.trim() ||
      process.env.DISCORD_BOT_TOKEN?.trim() ||
      undefined,
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
  },
  milestones: {
    guildId: process.env.MILESTONE_GUILD_ID?.trim() || undefined,
    checkIntervalMs: configuredCheckIntervalMs ?? 30_000,
    definitions: milestoneDefinitions,
  },
  // Which time zone decides where one calendar day ends on the activity card.
  activity: { timeZone: activityTimeZone },
  // Dirham economy. TARGET_GUILD_ID is checked at startup (see start.ts).
  economy: loadEconomyConfig(process.env),
} as const;
