import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import { logger } from "../config/logger.js";
import type { EconomyContext } from "../economy/context.js";
import type { EconomyConfig } from "../economy/economy-config.js";
import { formatDh } from "../economy/format.js";
import { isEconomyAdmin } from "../economy/permissions.js";
import { renderWeeklyTaskCard } from "../weekly/weekly-task-card.js";
import {
  WEEKLY_COMMAND_NAME,
  WEEKLY_DEFAULT_DAYS,
  WEEKLY_DESCRIPTION_MAX,
  WEEKLY_MAX_DAYS,
  WEEKLY_MAX_HOURS,
  WEEKLY_MAX_REWARD,
  WEEKLY_MIN_HOURS,
  WEEKLY_TITLE_MAX,
  formatDeadline,
  formatDuration,
  parseWeeklyId,
  progressBarText,
  weeklyIds,
  type WeeklyTask,
} from "../weekly/weekly-task-rules.js";

export { WEEKLY_BUTTON_PREFIX, WEEKLY_COMMAND_NAME } from "../weekly/weekly-task-rules.js";

const GOLD = 0xd9b45a;
const GRAY = 0x6b6b6b;
const CARD_FILE = "weekly-task.png";

// --------------------------------------------------------------- builder

export function buildWeeklyTaskCommandBuilder(config: EconomyConfig) {
  const builder = new SlashCommandBuilder()
    .setName(WEEKLY_COMMAND_NAME)
    .setDescription("Admin: post a weekly study task that pays Dirhams.")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Create a weekly study task and post its card.")
        .addStringOption((option) =>
          option
            .setName("title")
            .setDescription("Short title, for example: Study Marathon.")
            .setRequired(true)
            .setMaxLength(WEEKLY_TITLE_MAX),
        )
        .addIntegerOption((option) =>
          option
            .setName("hours")
            .setDescription("Voice study hours a member needs to finish the task.")
            .setRequired(true)
            .setMinValue(WEEKLY_MIN_HOURS)
            .setMaxValue(WEEKLY_MAX_HOURS),
        )
        .addIntegerOption((option) =>
          option
            .setName("reward")
            .setDescription(`Reward in ${config.currencyNamePlural}, paid once per member.`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(WEEKLY_MAX_REWARD),
        )
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("One or two lines shown on the card (optional).")
            .setRequired(false)
            .setMaxLength(WEEKLY_DESCRIPTION_MAX),
        )
        .addIntegerOption((option) =>
          option
            .setName("days")
            .setDescription(`How long the task runs (default ${WEEKLY_DEFAULT_DAYS} days).`)
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(WEEKLY_MAX_DAYS),
        )
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Where to post the card (default: this channel).")
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show the open weekly tasks."))
    .addSubcommand((sub) =>
      sub
        .setName("end")
        .setDescription("End a task now: its buttons stop working and the card turns gray.")
        .addStringOption((option) =>
          option.setName("id").setDescription("Task ID (see /weekly-task list).").setRequired(true).setMaxLength(16),
        ),
    );
  // With no ADMIN_ROLE_ID only Administrators see it. With one, everyone sees
  // the command and the bot checks the permission itself.
  builder.setDefaultMemberPermissions(config.adminRoleId ? null : PermissionFlagsBits.Administrator);
  return builder;
}

// --------------------------------------------------------------- helpers

function memberRoleIds(interaction: ChatInputCommandInteraction): string[] {
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) {
    return roles;
  }
  if (roles && "cache" in roles) {
    return [...roles.cache.keys()];
  }
  return [];
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function buttons(task: WeeklyTask, disabled: boolean) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(weeklyIds.claim(task.id))
      .setLabel("Claim reward")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(weeklyIds.progress(task.id))
      .setLabel("My progress")
      .setEmoji("📊")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

/** The message body for a task: embed + card picture + buttons. */
async function buildTaskMessage(ctx: EconomyContext, guild: Guild, task: WeeklyTask, ended: boolean) {
  const completions = await ctx.weekly.countCompletions(task.id);
  const now = new Date();
  const embed = new EmbedBuilder()
    .setColor(ended ? GRAY : GOLD)
    .setTitle(`📚 ${task.title}`)
    .setFooter({ text: `Task ${task.id}` });
  if (ended) {
    embed.setDescription("This weekly task has ended. Thank you to everyone who studied!");
  } else {
    embed.setDescription(
      `${task.description ? `${task.description}\n\n` : ""}Study **${formatDuration(task.goalSeconds)}** in a voice channel, then press **Claim reward** to get **${formatDh(task.reward, ctx.config)}**.\nEnds <t:${unixSeconds(task.endsAt)}:R>.`,
    );
  }
  const files: AttachmentBuilder[] = [];
  try {
    const png = await renderWeeklyTaskCard({
      serverName: guild.name,
      currencySymbol: ctx.config.currencySymbol,
      task: ended ? { ...task, status: "ended" } : task,
      completions,
      now,
    });
    files.push(new AttachmentBuilder(png, { name: CARD_FILE }));
    embed.setImage(`attachment://${CARD_FILE}`);
  } catch (error) {
    logger.warn({ err: error }, "Could not draw the weekly task card; posting the embed only.");
  }
  return { embeds: [embed], files, components: [buttons(task, ended)] };
}

/** Best effort: turns the posted card gray and disables its buttons. */
async function refreshPostedCard(ctx: EconomyContext, guild: Guild, task: WeeklyTask): Promise<boolean> {
  if (!task.channelId || !task.messageId) {
    return false;
  }
  try {
    const channel = await guild.channels.fetch(task.channelId);
    if (!channel || !channel.isTextBased()) {
      return false;
    }
    const message = await channel.messages.fetch(task.messageId);
    const body = await buildTaskMessage(ctx, guild, task, true);
    await message.edit({ ...body, attachments: [] });
    return true;
  } catch (error) {
    logger.warn({ err: error, taskId: task.id }, "Could not update the weekly task message.");
    return false;
  }
}

// -------------------------------------------------------------- handlers

export async function handleWeeklyTaskCommand(
  interaction: ChatInputCommandInteraction,
  ctx: EconomyContext,
  guild: Guild,
): Promise<void> {
  const allowed = isEconomyAdmin(
    {
      isAdministrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
      roleIds: memberRoleIds(interaction),
    },
    ctx.config,
  );
  if (!allowed) {
    await interaction.reply({ content: "Only server administrators can use this command.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  switch (interaction.options.getSubcommand()) {
    case "create":
      await handleCreate(interaction, ctx, guild);
      break;
    case "list":
      await handleList(interaction, ctx);
      break;
    case "end":
      await handleEnd(interaction, ctx, guild);
      break;
    default:
      await interaction.editReply({ content: "Unknown option." });
  }
}

async function handleCreate(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  const created = await ctx.weekly.create({
    title: interaction.options.getString("title", true),
    description: interaction.options.getString("description"),
    hours: interaction.options.getInteger("hours", true),
    reward: interaction.options.getInteger("reward", true),
    days: interaction.options.getInteger("days") ?? undefined,
    createdBy: interaction.user.id,
  });
  if (!created.ok) {
    await interaction.editReply({ content: `❌ ${created.message}` });
    return;
  }
  const task = created.task;
  const target = interaction.options.getChannel("channel") ?? interaction.channel;
  try {
    const channel = target ? await guild.channels.fetch(target.id) : null;
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      throw new Error("not a text channel");
    }
    const message = await channel.send(await buildTaskMessage(ctx, guild, task, false));
    await ctx.weekly.setMessage(task.id, channel.id, message.id);
    await interaction.editReply({
      content: `✅ Weekly task **${task.title}** (ID \`${task.id}\`) is live in <#${channel.id}>. It ends <t:${unixSeconds(task.endsAt)}:F>.`,
    });
  } catch (error) {
    logger.warn({ err: error, taskId: task.id }, "Could not post the weekly task card.");
    // Nobody can see this task, so close it instead of leaving it open.
    await ctx.weekly.end(task.id);
    await interaction.editReply({
      content:
        "❌ I could not post the card in that channel, so the task was cancelled. Check that I can view, send messages, embed links and attach files there, then try again.",
    });
  }
}

async function handleList(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  const tasks = await ctx.weekly.listOpen();
  if (tasks.length === 0) {
    await interaction.editReply({ content: "There are no open weekly tasks. Use `/weekly-task create` to start one." });
    return;
  }
  const lines = await Promise.all(
    tasks.map(async (task) => {
      const done = await ctx.weekly.countCompletions(task.id);
      const place = task.channelId ? ` in <#${task.channelId}>` : "";
      return `\`${task.id}\` **${task.title}**${place}\n${formatDuration(task.goalSeconds)} → ${formatDh(task.reward, ctx.config)} · ends <t:${unixSeconds(task.endsAt)}:R> · ${done} completed`;
    }),
  );
  const embed = new EmbedBuilder().setColor(GOLD).setTitle("📚 Open weekly tasks").setDescription(lines.join("\n\n"));
  await interaction.editReply({ embeds: [embed] });
}

async function handleEnd(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  const id = interaction.options.getString("id", true).trim().toLowerCase();
  const ended = await ctx.weekly.end(id);
  if (!ended) {
    await interaction.editReply({ content: "❌ I could not find an open task with that ID. Use `/weekly-task list`." });
    return;
  }
  const updated = await refreshPostedCard(ctx, guild, ended);
  await interaction.editReply({
    content: `✅ Task \`${ended.id}\` **${ended.title}** has ended.${updated ? " Its card was updated." : " I could not update its card message."}`,
  });
}

// ------------------------------------------------------- member buttons

export async function handleWeeklyTaskComponent(interaction: ButtonInteraction, ctx: EconomyContext): Promise<void> {
  const action = parseWeeklyId(interaction.customId);
  if (!action) {
    await interaction.reply({ content: "That button is not valid any more.", ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  if (action.kind === "claim") {
    const result = await ctx.weekly.claim(action.taskId, interaction.user.id);
    if (!result.ok) {
      await interaction.editReply({ content: `❌ ${result.message}` });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("🎉 Task complete!")
      .setDescription(`You finished **${result.task.title}** and earned **${formatDh(result.reward, ctx.config)}**.`)
      .addFields({ name: "New balance", value: `${ctx.config.currencyEmoji} ${formatDh(result.balance, ctx.config)}` });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const status = await ctx.weekly.progress(action.taskId, interaction.user.id);
  if (!status.ok) {
    await interaction.editReply({ content: `❌ ${status.message}` });
    return;
  }
  const { task, progress, claimed, open } = status;
  let hint = `Keep going: **${formatDuration(progress.remainingSeconds)}** to go.`;
  if (claimed) {
    hint = "✅ You already claimed this reward.";
  } else if (progress.done) {
    hint = open ? "🎁 Goal reached! Press **Claim reward** on the card." : "This task is closed.";
  } else if (!open) {
    hint = "This task is closed.";
  }
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle(`📊 ${task.title}`)
    .setDescription(
      `${progressBarText(progress.percent)} **${progress.percent}%**\n${formatDuration(progress.seconds)} of ${formatDuration(progress.goalSeconds)}\n\n${hint}`,
    )
    .setFooter({ text: `Counts until ${formatDeadline(task.endsAt)}` });
  await interaction.editReply({ embeds: [embed] });
}
