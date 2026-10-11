import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import { logger } from "../config/logger.js";
import {
  formatHoursLabel,
  planMilestoneEdit,
} from "../milestones/milestone-settings.js";
import type { MilestoneDefinition } from "../milestones/types.js";
import {
  SeasonResetInProgressError,
  type SeasonResetOutcome,
  type SeasonResetPreview,
} from "../season/season-service.js";
import { formatVoiceDuration } from "./voice-command-utils.js";

export const ADMIN_COMMAND_NAME = "voiceadmin";

const MAX_HOURS = 10_000;

/** The word an admin must type to confirm a season reset. */
export const SEASON_RESET_CONFIRMATION = "RESET";

export const adminSlashCommandBuilder = new SlashCommandBuilder()
  .setName(ADMIN_COMMAND_NAME)
  .setDescription("Admin tools for voice time and milestones.")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("time-add")
      .setDescription("Add voice time to a member.")
      .addUserOption((option) =>
        option.setName("user").setDescription("The member.").setRequired(true),
      )
      .addNumberOption((option) =>
        option
          .setName("hours")
          .setDescription("Hours to add. Decimals work, e.g. 1.5")
          .setRequired(true)
          .setMinValue(0.01)
          .setMaxValue(MAX_HOURS),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("time-remove")
      .setDescription("Remove voice time from a member.")
      .addUserOption((option) =>
        option.setName("user").setDescription("The member.").setRequired(true),
      )
      .addNumberOption((option) =>
        option
          .setName("hours")
          .setDescription("Hours to remove. Decimals work, e.g. 1.5")
          .setRequired(true)
          .setMinValue(0.01)
          .setMaxValue(MAX_HOURS),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("time-set")
      .setDescription("Set a member's total voice time.")
      .addUserOption((option) =>
        option.setName("user").setDescription("The member.").setRequired(true),
      )
      .addNumberOption((option) =>
        option
          .setName("hours")
          .setDescription("The new total in hours. Decimals work.")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(MAX_HOURS),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("milestone-time")
      .setDescription("Change how many hours a milestone needs.")
      .addIntegerOption((option) =>
        option
          .setName("tier")
          .setDescription("Milestone number (1-10).")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10),
      )
      .addNumberOption((option) =>
        option
          .setName("hours")
          .setDescription("Hours needed. Decimals work.")
          .setRequired(true)
          .setMinValue(0.02)
          .setMaxValue(MAX_HOURS),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("milestone-role")
      .setDescription("Change the role given for a milestone.")
      .addIntegerOption((option) =>
        option
          .setName("tier")
          .setDescription("Milestone number (1-10).")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(10),
      )
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The new role for this milestone.")
          .setRequired(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("remove_old")
          .setDescription(
            "Also take the old role away from members who have it. Default: no.",
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("milestones")
      .setDescription("Show every milestone with its hours and role."),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("season-reset")
      .setDescription(
        "Start a new season: everyone restarts milestones and study roles. Wallets and the shop are kept.",
      )
      .addStringOption((option) =>
        option
          .setName("confirm")
          .setDescription(
            `Leave empty to preview. Type ${SEASON_RESET_CONFIRMATION} to run the reset.`,
          ),
      ),
  );

export type VoiceTimeAdjustMode = "add" | "remove" | "set";

export interface AdminCommandDeps {
  // The live milestone list shared with the rest of the bot.
  definitions: MilestoneDefinition[];
  adjustUserVoiceTime(
    discordUserId: string,
    mode: VoiceTimeAdjustMode,
    seconds: number,
  ): Promise<{ before: number; after: number }>;
  saveMilestoneSetting(input: {
    milestoneId: string;
    requiredVoiceTimeSeconds?: number;
    roleId?: string;
    updatedBy: string;
  }): Promise<void>;
  // Re-check everyone's milestones right away instead of waiting for the timer.
  recheckMilestones(): Promise<void>;
  // Season reset: progress and study roles only, never wallets or the shop.
  season: SeasonController;
}

export interface SeasonController {
  preview(): Promise<SeasonResetPreview>;
  reset(startedBy: string): Promise<SeasonResetOutcome>;
}

function roleLabel(roleId: string | null): string {
  return roleId ? `<@&${roleId}>` : "no role set";
}

async function removeRoleFromHolders(
  guild: Guild,
  roleId: string,
): Promise<{ removed: number; failed: number } | null> {
  const role =
    guild.roles.cache.get(roleId) ??
    (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) {
    return null;
  }

  await guild.members.fetch();
  let removed = 0;
  let failed = 0;
  for (const member of role.members.values()) {
    try {
      await member.roles.remove(role);
      removed += 1;
    } catch (error) {
      failed += 1;
      logger.warn(
        { err: error, roleId, discordUserId: member.id },
        "Could not remove the old milestone role from a member.",
      );
    }
  }
  return { removed, failed };
}

async function handleTimeCommand(
  interaction: ChatInputCommandInteraction,
  deps: AdminCommandDeps,
  mode: VoiceTimeAdjustMode,
): Promise<string> {
  const user = interaction.options.getUser("user", true);
  if (user.bot) {
    return "Bots don't have voice time.";
  }
  const hours = interaction.options.getNumber("hours", true);
  if (!Number.isFinite(hours) || hours < 0 || hours > MAX_HOURS) {
    return `Hours must be between 0 and ${MAX_HOURS}.`;
  }
  const seconds = Math.round(hours * 3600);
  if (mode !== "set" && seconds < 1) {
    return "That amount is too small.";
  }

  const { before, after } = await deps.adjustUserVoiceTime(user.id, mode, seconds);
  logger.info(
    {
      adminId: interaction.user.id,
      targetId: user.id,
      mode,
      seconds,
      before,
      after,
    },
    "Admin adjusted a member's voice time.",
  );
  void deps.recheckMilestones().catch((error: unknown) => {
    logger.warn({ err: error }, "Milestone re-check after an admin edit failed.");
  });

  const verb =
    mode === "add"
      ? `Added **${formatVoiceDuration(seconds)}** to`
      : mode === "remove"
        ? `Removed **${formatVoiceDuration(seconds)}** from`
        : "Set the total for";
  const keepNote =
    mode === "add"
      ? ""
      : "\nMilestones a member has already reached are kept, even if their time goes down.";
  return (
    `${verb} <@${user.id}>.\n` +
    `Saved total: **${formatVoiceDuration(before)}** → **${formatVoiceDuration(after)}** ` +
    `(a session still in progress is not included). Roles update within seconds.` +
    keepNote
  );
}

async function handleMilestoneTime(
  interaction: ChatInputCommandInteraction,
  deps: AdminCommandDeps,
): Promise<string> {
  const tier = interaction.options.getInteger("tier", true);
  const hours = interaction.options.getNumber("hours", true);
  const plan = planMilestoneEdit(deps.definitions, {
    milestoneId: String(tier),
    hours,
  });
  if (!plan.ok) {
    return plan.error;
  }

  await deps.saveMilestoneSetting({
    milestoneId: plan.next.id,
    requiredVoiceTimeSeconds: plan.next.requiredVoiceTimeSeconds,
    updatedBy: interaction.user.id,
  });
  const live = deps.definitions.find((milestone) => milestone.id === plan.next.id);
  if (live) {
    live.requiredVoiceTimeSeconds = plan.next.requiredVoiceTimeSeconds;
  }
  logger.info(
    {
      adminId: interaction.user.id,
      milestoneId: plan.next.id,
      before: plan.previous.requiredVoiceTimeSeconds,
      after: plan.next.requiredVoiceTimeSeconds,
    },
    "Admin changed a milestone's required time.",
  );
  void deps.recheckMilestones().catch((error: unknown) => {
    logger.warn({ err: error }, "Milestone re-check after an admin edit failed.");
  });

  return (
    `Tier ${plan.next.id} now needs **${formatHoursLabel(plan.next.requiredVoiceTimeSeconds)}** ` +
    `(was ${formatHoursLabel(plan.previous.requiredVoiceTimeSeconds)}).\n` +
    "Members who already reached it keep it. New qualifiers get it within seconds."
  );
}

async function handleMilestoneRole(
  interaction: ChatInputCommandInteraction,
  guild: Guild,
  deps: AdminCommandDeps,
): Promise<string> {
  const tier = interaction.options.getInteger("tier", true);
  const picked = interaction.options.getRole("role", true);
  const removeOld = interaction.options.getBoolean("remove_old") ?? false;

  const role =
    guild.roles.cache.get(picked.id) ??
    (await guild.roles.fetch(picked.id).catch(() => null));
  if (!role) {
    return "I couldn't find that role.";
  }
  if (role.id === guild.id) {
    return "@everyone can't be a milestone role.";
  }
  if (role.managed) {
    return "That role belongs to a bot or integration and can't be given to members.";
  }
  if (!role.editable) {
    return "I can't hand out that role. Give my bot the Manage Roles permission and move my bot's role above it in Server Settings → Roles.";
  }

  const plan = planMilestoneEdit(deps.definitions, {
    milestoneId: String(tier),
    roleId: role.id,
  });
  if (!plan.ok) {
    return plan.error;
  }
  if (plan.previous.roleId === role.id) {
    return `Tier ${plan.next.id} already uses ${roleLabel(role.id)}.`;
  }

  await deps.saveMilestoneSetting({
    milestoneId: plan.next.id,
    roleId: role.id,
    updatedBy: interaction.user.id,
  });
  const live = deps.definitions.find((milestone) => milestone.id === plan.next.id);
  if (live) {
    live.roleId = role.id;
  }
  logger.info(
    {
      adminId: interaction.user.id,
      milestoneId: plan.next.id,
      before: plan.previous.roleId,
      after: role.id,
    },
    "Admin changed a milestone's role.",
  );
  void deps.recheckMilestones().catch((error: unknown) => {
    logger.warn({ err: error }, "Milestone re-check after an admin edit failed.");
  });

  let message = `Tier ${plan.next.id} now gives ${roleLabel(role.id)} (was ${roleLabel(plan.previous.roleId)}).`;
  if (plan.previous.roleId) {
    if (removeOld) {
      const result = await removeRoleFromHolders(guild, plan.previous.roleId);
      if (result) {
        message += `\nRemoved the old role from ${result.removed} member(s)${
          result.failed > 0 ? `; ${result.failed} could not be changed` : ""
        }.`;
      } else {
        message += "\nThe old role no longer exists, so there was nothing to remove.";
      }
    } else {
      message +=
        "\nMembers who already have the old role keep it. Run this again with remove_old set to true to take it away.";
    }
  }
  message += "\nMembers get the new role within seconds.";
  return message;
}

function handleMilestoneList(deps: AdminCommandDeps): string {
  const lines = deps.definitions.map(
    (milestone) =>
      `Tier ${milestone.id} · ${formatHoursLabel(milestone.requiredVoiceTimeSeconds)} · ${roleLabel(milestone.roleId)}`,
  );
  return `**Milestones**\n${lines.join("\n")}`;
}

async function handleSeasonReset(
  interaction: ChatInputCommandInteraction,
  deps: AdminCommandDeps,
): Promise<string> {
  const typed = interaction.options.getString("confirm")?.trim() ?? "";

  if (typed !== SEASON_RESET_CONFIRMATION) {
    const preview = await deps.season.preview();
    const roles = deps.definitions
      .map((milestone) => milestone.roleId)
      .filter((id): id is string => Boolean(id))
      .map((id) => `<@&${id}>`);
    const wrong =
      typed.length > 0
        ? `\n"${typed}" is not the confirmation word, so nothing was changed.\n`
        : "";
    return (
      `**Season reset preview** (season ${preview.season} → ${preview.season + 1})${wrong}\n` +
      `**Will be reset:**\n` +
      `• Voice time, milestone progress and XP of **${preview.members}** member(s)\n` +
      `• **${preview.milestoneRecords}** reached-milestone record(s)\n` +
      `• Study roles taken from every member who has them: ${roles.length > 0 ? roles.join(" ") : "none configured"}\n\n` +
      `**Will NOT be touched:** wallets and the Dirham history, shop items, purchases and owned color roles, weekly tasks, milestone hours and roles settings.\n\n` +
      `Milestone Dirham rewards can be earned again in the new season. ` +
      `To go ahead, run \`/voiceadmin season-reset confirm:${SEASON_RESET_CONFIRMATION}\`. This cannot be undone.`
    );
  }

  let outcome: SeasonResetOutcome;
  try {
    outcome = await deps.season.reset(interaction.user.id);
  } catch (error) {
    if (error instanceof SeasonResetInProgressError) {
      return "A season reset is already running. Wait for it to finish.";
    }
    throw error;
  }
  logger.info(
    { adminId: interaction.user.id, season: outcome.season },
    "Admin started a new season.",
  );

  const lines = [
    `**Season ${outcome.season} has started.**`,
    `• Reset **${outcome.members}** member(s) and cleared **${outcome.milestoneRecords}** milestone record(s).`,
  ];
  if (outcome.roles.failed < 0) {
    lines.push(
      "• ⚠️ Progress was reset, but I could not remove the study roles. Check the bot's logs and remove them by hand.",
    );
  } else {
    lines.push(`• Removed study roles from **${outcome.roles.removed}** member role assignment(s).`);
    if (outcome.roles.failed > 0) {
      lines.push(
        `• ⚠️ **${outcome.roles.failed}** role removal(s) failed (check that my role is above the study roles). Those members keep the old role until you remove it by hand.`,
      );
    }
  }
  if (outcome.roles.missingRoleIds.length > 0) {
    lines.push(
      `• ⚠️ These configured roles no longer exist: ${outcome.roles.missingRoleIds.map((id) => `\`${id}\``).join(", ")}.`,
    );
  }
  if (outcome.protectedRoleIds.length > 0) {
    lines.push(
      `• Skipped ${outcome.protectedRoleIds.map((id) => `<@&${id}>`).join(" ")} because the shop sells it as a color role.`,
    );
  }
  lines.push(
    "• Wallets, the shop, purchases and owned color roles were not touched.",
  );
  return lines.join("\n");
}

export async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  deps: AdminCommandDeps,
): Promise<void> {
  if (interaction.commandName !== ADMIN_COMMAND_NAME) {
    return;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: "Use this command in a Discord server.",
      ephemeral: true,
    });
    return;
  }
  // Server owners can change who sees a command, so check the permission again.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only server administrators can use this command.",
      ephemeral: true,
    });
    return;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();
    let content: string;
    switch (subcommand) {
      case "time-add":
        content = await handleTimeCommand(interaction, deps, "add");
        break;
      case "time-remove":
        content = await handleTimeCommand(interaction, deps, "remove");
        break;
      case "time-set":
        content = await handleTimeCommand(interaction, deps, "set");
        break;
      case "milestone-time":
        content = await handleMilestoneTime(interaction, deps);
        break;
      case "milestone-role":
        content = await handleMilestoneRole(interaction, guild, deps);
        break;
      case "milestones":
        content = handleMilestoneList(deps);
        break;
      case "season-reset":
        content = await handleSeasonReset(interaction, deps);
        break;
      default:
        content = "Unknown admin command.";
    }
    await interaction.editReply({ content });
  } catch (error) {
    logger.error(
      { err: error, adminId: interaction.user.id },
      "Could not complete an admin voice command.",
    );
    try {
      const content = "Something went wrong. Check the bot's logs, then check the result with /voiceadmin milestones.";
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch {
      logger.warn("Could not send the admin command error response.");
    }
  }
}
