import {
  ActionRowBuilder,
  ApplicationCommandType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Guild,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { logger } from "../config/logger.js";
import {
  getActiveVoiceSession,
  getUserData,
  getVoiceTimeLeaderboardData,
  getVoiceTimeRank,
} from "../database/index.js";
import { getEconomyContext, type EconomyContext } from "../economy/context.js";
import type { EconomyConfig } from "../economy/economy-config.js";
import { ADMIN_GIVE_MAX, type GameActionResult } from "../economy/economy-service.js";
import {
  formatDh,
  formatDhWithEmoji,
  fullTimestamp,
  relativeTimestamp,
} from "../economy/format.js";
import { isEconomyAdmin, isTargetGuild } from "../economy/permissions.js";
import {
  balanceEmbed,
  baseEmbed,
  renderGame,
  type RenderContext,
} from "../economy/render.js";
import {
  LEADERBOARD_PODIUM_SIZE,
  LEADERBOARD_SERVER_LABEL,
  leaderboardPageCount,
  leaderboardRowRange,
} from "../leaderboard/leaderboard-card-data.js";
import { renderLeaderboardCard } from "../leaderboard/leaderboard-card.js";
import { renderMoneyLeaderboardCard } from "../leaderboard/money-leaderboard-card.js";
import { adminSlashCommandBuilder } from "./admin-commands.js";
import { fitFieldLines, helpExtraLines, type RegisteredCommandInfo } from "./help-extra.js";
import {
  SHOP_BUTTON_PREFIX,
  SHOP_COMMAND_NAME,
  WARDROBE_BUTTON_PREFIX,
  WARDROBE_COMMAND_NAME,
  buildShopCommandBuilder,
  buildWardrobeCommandBuilder,
  handleShopCommand,
  handleShopComponent,
  handleWardrobeCommand,
  handleWardrobeComponent,
} from "./shop-commands.js";
import {
  SHOP_ADMIN_COMMAND_NAME,
  buildShopAdminCommandBuilder,
  handleShopAdminCommand,
} from "./shop-admin-commands.js";
import {
  QUIZ_BUTTON_PREFIX,
  QUIZ_COMMANDS,
  buildQuizCommandBuilders,
  handleQuizCommand,
  handleQuizComponent,
} from "./quiz-commands.js";
import {
  WEEKLY_BUTTON_PREFIX,
  WEEKLY_COMMAND_NAME,
  buildWeeklyTaskCommandBuilder,
  handleWeeklyTaskCommand,
  handleWeeklyTaskComponent,
} from "./weekly-task-commands.js";
import { formatVoiceDuration, voiceSlashCommandBuilders } from "./voice-command-utils.js";

// ---------------------------------------------------------------- catalog

type CatalogEntry = {
  name: string;
  category: string;
  description: string;
  usage: string;
  adminOnly?: boolean;
};

/** Everything /help may list. A command only shows if it was really registered. */
const CATALOG: CatalogEntry[] = [
  { name: "profile", category: "Voice & Profile", description: "Voice rank, time, milestone progress, roles and balance.", usage: "/profile [member]" },
  { name: "voicestats", category: "Voice & Profile", description: "Detailed voice-time statistics.", usage: "/voicestats [member]" },
  { name: "rank", category: "Voice & Profile", description: "Your position by voice time.", usage: "/rank" },
  { name: "leaderboard", category: "Voice & Profile", description: "Top members by voice time.", usage: "/leaderboard" },
  { name: "balance", category: "Economy", description: "Show a wallet balance.", usage: "/balance [member]" },
  { name: "topmoney", category: "Economy", description: "The money leaderboard: members ranked by balance, as a picture card with pages.", usage: "/topmoney" },
  { name: "shop", category: "Economy", description: "Buy name colors with Dirhams.", usage: "/shop" },
  { name: "wardrobe", category: "Economy", description: "Put on or take off the name colors you own.", usage: "/wardrobe" },
  { name: "transfer", category: "Economy", description: "Send Dirhams to another member (small tax).", usage: "/transfer user amount" },
  { name: "work", category: "Economy", description: "Claim your work reward.", usage: "/work" },
  { name: "daily", category: "Economy", description: "Claim your daily reward.", usage: "/daily" },
  { name: "coinflip", category: "Games", description: "Heads or tails for a wager.", usage: "/coinflip wager choice" },
  { name: "mines", category: "Games", description: "Reveal safe tiles and cash out before hitting a mine.", usage: "/mines wager [mines]" },
  { name: "blackjack", category: "Games", description: "Beat the dealer to 21.", usage: "/blackjack wager" },
  { name: "appletower", category: "Games", description: "Climb the tower by picking the safe apple.", usage: "/appletower wager" },
  { name: "guessflag", category: "Games", description: "Guess the country from its flag. Faster answers pay more.", usage: "/guessflag" },
  { name: "guessmap", category: "Games", description: "Guess the highlighted country on the map. Faster answers pay more.", usage: "/guessmap" },
  { name: "guesslogo", category: "Games", description: "Guess the brand from its logo. Faster answers pay more.", usage: "/guesslogo" },
  { name: "help", category: "Help", description: "List every available command.", usage: "/help" },
  { name: "voiceadmin", category: "Admin", description: "Add, remove or set a member's voice time.", usage: "/voiceadmin time-add | time-remove | time-set user hours", adminOnly: true },
  { name: "voiceadmin", category: "Admin", description: "Change the hours or the role of a milestone, or list them all.", usage: "/voiceadmin milestone-time tier hours | milestone-role tier role [remove_old] | milestones", adminOnly: true },
  { name: "voiceadmin", category: "Admin", description: "Start a new season: everyone restarts milestones and study roles. Wallets and the shop are kept.", usage: "/voiceadmin season-reset [confirm]", adminOnly: true },
  { name: "weekly-task", category: "Admin", description: "Post a weekly study task card that pays Dirhams for voice study time.", usage: "/weekly-task create title hours reward [description] [days] [channel] | list | end id", adminOnly: true },
  { name: "shop-config", category: "Admin", description: "Choose which color roles are for sale and their prices.", usage: "/shop-config add | edit | remove | list | check", adminOnly: true },
  { name: "economy-admin", category: "Admin", description: "Add or remove Dirhams on a member's balance, or manage the currency image.", usage: "/economy-admin give user amount | take user amount | image-view | image-set | image-clear", adminOnly: true },
];

const CATEGORY_ORDER = ["Voice & Profile", "Economy", "Games", "Help", "Admin"];

const registeredNames = new Set<string>();
/** What each registered command is, so /help can list any the catalog forgot. */
const registeredInfo = new Map<string, RegisteredCommandInfo>();

// --------------------------------------------------------------- builders

function wagerOption(config: EconomyConfig) {
  return (option: import("discord.js").SlashCommandIntegerOption) =>
    option
      .setName("wager")
      .setDescription(
        `How many ${config.currencyNamePlural} to wager (${config.minBet.toLocaleString("en-US")}-${config.maxBet.toLocaleString("en-US")}).`,
      )
      .setRequired(true)
      .setMinValue(config.minBet)
      .setMaxValue(config.maxBet);
}

export function buildEconomyCommandBuilders(config: EconomyConfig) {
  const admin = new SlashCommandBuilder()
    .setName("economy-admin")
    .setDescription(`Admin tools for the ${config.currencyName} economy.`)
    .addSubcommand((sub) =>
      sub.setName("image-view").setDescription("Show the current currency image."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("image-set")
        .setDescription("Set or replace the currency image from an https link.")
        .addStringOption((option) =>
          option
            .setName("url")
            .setDescription("Direct https link to a PNG, JPEG, GIF or WebP image (max 5 MB).")
            .setRequired(true)
            .setMaxLength(500),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("image-clear").setDescription("Remove the currency image (DH text is used instead)."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("give")
        .setDescription(`Add ${config.currencyNamePlural} to a member's balance.`)
        .addUserOption((option) =>
          option.setName("user").setDescription("The member who receives them.").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription(`How many ${config.currencyNamePlural} to add (1 to ${ADMIN_GIVE_MAX.toLocaleString("en-US")}).`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(ADMIN_GIVE_MAX),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("take")
        .setDescription(`Remove ${config.currencyNamePlural} from a member's balance.`)
        .addUserOption((option) =>
          option.setName("user").setDescription("The member who loses them.").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("amount")
            .setDescription(`How many ${config.currencyNamePlural} to remove (1 to ${ADMIN_GIVE_MAX.toLocaleString("en-US")}).`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(ADMIN_GIVE_MAX),
        ),
    );
  // With no ADMIN_ROLE_ID only Administrators see it. With one, the command is
  // visible to everyone and the bot checks the permission itself.
  admin.setDefaultMemberPermissions(config.adminRoleId ? null : PermissionFlagsBits.Administrator);

  return [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("List every available command."),
    new SlashCommandBuilder()
      .setName("balance")
      .setDescription(`Show a ${config.currencyName} balance.`)
      .addUserOption((option) =>
        option.setName("user").setDescription("Member to look up (default: you).").setRequired(false),
      ),
    new SlashCommandBuilder()
      .setName("topmoney")
      .setDescription(`See the richest members by ${config.currencyName} balance.`),
    new SlashCommandBuilder()
      .setName("transfer")
      .setDescription(`Send ${config.currencyNamePlural} to a member (${config.payTaxPercent}% tax).`)
      .addUserOption((option) =>
        option.setName("user").setDescription("The member who receives them.").setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription(
            `How many ${config.currencySymbol} to send (${config.payMinAmount.toLocaleString("en-US")}-${config.payMaxAmount.toLocaleString("en-US")}).`,
          )
          .setRequired(true)
          .setMinValue(config.payMinAmount)
          .setMaxValue(config.payMaxAmount),
      ),
    new SlashCommandBuilder()
      .setName("work")
      .setDescription(`Work for ${config.workRewardAmount.toLocaleString("en-US")} ${config.currencySymbol} (every ${config.workCooldownHours}h).`),
    new SlashCommandBuilder()
      .setName("daily")
      .setDescription(`Claim ${config.dailyRewardAmount.toLocaleString("en-US")} ${config.currencySymbol} (every ${config.dailyCooldownHours}h).`),
    new SlashCommandBuilder()
      .setName("coinflip")
      .setDescription("Flip a coin for a wager.")
      .addIntegerOption(wagerOption(config))
      .addStringOption((option) =>
        option
          .setName("choice")
          .setDescription("Heads or tails?")
          .setRequired(true)
          .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" }),
      ),
    new SlashCommandBuilder()
      .setName("mines")
      .setDescription("Reveal safe tiles on a 5x4 board and cash out before hitting a mine.")
      .addIntegerOption(wagerOption(config))
      .addIntegerOption((option) =>
        option
          .setName("mines")
          .setDescription(`Number of mines (1-${config.minesMaxCount}, default ${config.minesDefaultCount}).`)
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(config.minesMaxCount),
      ),
    new SlashCommandBuilder()
      .setName("blackjack")
      .setDescription("Play blackjack against the dealer.")
      .addIntegerOption(wagerOption(config)),
    new SlashCommandBuilder()
      .setName("appletower")
      .setDescription("Climb the tower by picking the one safe apple on each level.")
      .addIntegerOption(wagerOption(config)),
    ...buildQuizCommandBuilders(config),
    buildShopCommandBuilder(config),
    buildWardrobeCommandBuilder(),
    buildShopAdminCommandBuilder(config),
    buildWeeklyTaskCommandBuilder(config),
    admin,
  ];
}

export function allGuildCommandBuilders(config: EconomyConfig) {
  return [
    ...voiceSlashCommandBuilders,
    adminSlashCommandBuilder,
    ...buildEconomyCommandBuilders(config),
  ];
}

export const ECONOMY_COMMAND_NAMES = new Set([
  "help", "balance", "transfer", "work", "daily", "coinflip", "mines", "blackjack",
  "appletower", "economy-admin", "leaderboard", "topmoney", SHOP_COMMAND_NAME, WARDROBE_COMMAND_NAME, SHOP_ADMIN_COMMAND_NAME, WEEKLY_COMMAND_NAME,
  ...Object.keys(QUIZ_COMMANDS),
]);

/**
 * Registers every command in the one target server (guild commands show up
 * instantly), and removes older global copies of the same commands so members
 * never see duplicates.
 */
export async function registerGuildCommands(
  client: Client,
  config: EconomyConfig,
): Promise<string[]> {
  if (!config.guildId) {
    throw new Error("TARGET_GUILD_ID is not set.");
  }
  const guild = await client.guilds.fetch(config.guildId);
  const builders = allGuildCommandBuilders(config);
  const payloads = builders.map((builder) => builder.toJSON());
  await guild.commands.set(payloads);

  registeredNames.clear();
  registeredInfo.clear();
  for (const payload of payloads) {
    registeredNames.add(payload.name);
    registeredInfo.set(payload.name, {
      description: payload.description,
      adminOnly: payload.default_member_permissions != null,
    });
  }

  try {
    const application = client.application;
    if (application) {
      const globals = await application.commands.fetch();
      for (const command of globals.values()) {
        if (command.type === ApplicationCommandType.ChatInput && registeredNames.has(command.name)) {
          await command.delete();
        }
      }
    }
  } catch (error) {
    logger.warn({ err: error }, "Could not remove old global copies of the slash commands.");
  }
  return [...registeredNames];
}

// ---------------------------------------------------------------- helpers

async function renderContext(ctx: EconomyContext): Promise<RenderContext> {
  return { config: ctx.config, imageUrl: await ctx.images.getUrl() };
}

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

function isAdmin(interaction: ChatInputCommandInteraction, config: EconomyConfig): boolean {
  return isEconomyAdmin(
    {
      isAdministrator: interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
      roleIds: memberRoleIds(interaction),
    },
    config,
  );
}

async function memberName(guild: Guild, userId: string, fallback: string): Promise<string> {
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  return member?.displayName ?? fallback;
}

async function resolveNames(guild: Guild, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (ids.length > 0) {
    await guild.members.fetch({ user: ids }).catch(() => undefined);
  }
  for (const id of ids) {
    const member = guild.members.cache.get(id);
    names.set(id, member ? member.displayName : "Former member");
  }
  return names;
}

/** Public replies are deferred; errors are removed and re-sent privately. */
async function privateError(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

// ------------------------------------------------------------ simple cmds

async function handleHelp(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  const showAdmin = isAdmin(interaction, ctx.config);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("Commands")
    .setDescription(
      `Earn ${ctx.config.currencyNamePlural} (${ctx.config.currencySymbol}) by spending time in voice channels, with /work and /daily, and by milestones.`,
    );
  for (const category of CATEGORY_ORDER) {
    const lines = CATALOG.filter(
      (entry) =>
        entry.category === category &&
        registeredNames.has(entry.name) &&
        (!entry.adminOnly || showAdmin),
    ).map((entry) => `\`${entry.usage}\`\n${entry.description}`);
    if (lines.length > 0) {
      embed.addFields({ name: category, value: lines.join("\n") });
    }
  }
  // Any registered command without a catalog entry is still listed.
  const extra = fitFieldLines(
    helpExtraLines(registeredInfo, new Set(CATALOG.map((entry) => entry.name)), showAdmin),
  );
  if (extra) {
    embed.addFields({ name: "Other", value: extra });
  }
  const image = await ctx.images.getUrl();
  if (image) {
    embed.setThumbnail(image);
  }
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleBalance(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") ?? interaction.user;
  if (target.bot) {
    await privateError(interaction, "Bots do not have wallets.");
    return;
  }
  const [balance, render] = await Promise.all([
    ctx.service.getBalance(target.id),
    renderContext(ctx),
  ]);
  const name = await memberName(guild, target.id, target.globalName ?? target.username);
  await interaction.editReply({ embeds: [balanceEmbed(render, name, balance)] });
}

async function handlePay(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);
  if (target.bot) {
    await privateError(interaction, "Bots do not have wallets.");
    return;
  }
  const result = await ctx.service.pay({
    fromUserId: interaction.user.id,
    toUserId: target.id,
    amount,
    interactionId: interaction.id,
  });
  if (!result.ok) {
    await privateError(interaction, result.message);
    return;
  }
  const render = await renderContext(ctx);
  const targetName = await memberName(guild, target.id, target.globalName ?? target.username);
  const embed = baseEmbed(render, "💸 Payment sent")
    .setDescription(`<@${interaction.user.id}> sent **${formatDh(result.received, ctx.config)}** to <@${target.id}> (${targetName}).`)
    .addFields(
      { name: "Sent", value: formatDh(result.amount, ctx.config), inline: true },
      { name: `Tax (${ctx.config.payTaxPercent}%)`, value: formatDh(result.tax, ctx.config), inline: true },
      { name: "Received", value: formatDh(result.received, ctx.config), inline: true },
      { name: "Your balance", value: formatDhWithEmoji(result.fromBalance, ctx.config), inline: true },
    );
  await interaction.editReply({ embeds: [embed], allowedMentions: { users: [target.id] } });
}

async function handleCooldownReward(
  interaction: ChatInputCommandInteraction,
  ctx: EconomyContext,
  kind: "work" | "daily",
) {
  await interaction.deferReply();
  const result = kind === "work" ? await ctx.service.work(interaction.user.id) : await ctx.service.daily(interaction.user.id);
  if (!result.ok) {
    await privateError(
      interaction,
      `You can claim /${kind} again ${relativeTimestamp(result.nextClaimAt)} (${fullTimestamp(result.nextClaimAt)}).`,
    );
    return;
  }
  const render = await renderContext(ctx);
  const embed = baseEmbed(render, kind === "work" ? "💼 Work" : "📅 Daily reward").addFields(
    { name: "Reward", value: formatDhWithEmoji(result.amount, ctx.config), inline: true },
    { name: "New balance", value: formatDhWithEmoji(result.balance, ctx.config), inline: true },
    { name: "Next claim", value: `${relativeTimestamp(result.nextClaimAt)}`, inline: true },
  );
  await interaction.editReply({ embeds: [embed] });
}

async function handleCoinflip(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  await interaction.deferReply();
  const wager = interaction.options.getInteger("wager", true);
  const choice = interaction.options.getString("choice", true) as "heads" | "tails";
  const result = await ctx.service.coinflip({
    userId: interaction.user.id,
    wager,
    choice,
    interactionId: interaction.id,
  });
  if (!result.ok) {
    await privateError(interaction, result.message);
    return;
  }
  const render = await renderContext(ctx);
  const embed = baseEmbed(render, "🪙 Coinflip")
    .setColor(result.won ? 0x2ecc71 : 0xe74c3c)
    .setDescription(
      `You chose **${result.choice}** and the coin landed on **${result.landed}**.\n${result.won ? "✅ You win!" : "❌ You lose."}`,
    )
    .addFields(
      { name: "Wager", value: formatDh(result.wager, ctx.config), inline: true },
      {
        name: "Net",
        value: `${result.net >= 0 ? "+" : "-"}${formatDh(Math.abs(result.net), ctx.config)}`,
        inline: true,
      },
      { name: "Balance", value: formatDhWithEmoji(result.balance, ctx.config), inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

async function handleGameStart(
  interaction: ChatInputCommandInteraction,
  ctx: EconomyContext,
  game: "mines" | "appletower" | "blackjack",
) {
  await interaction.deferReply();
  const wager = interaction.options.getInteger("wager", true);
  const channelId = interaction.channelId ?? null;
  let result: GameActionResult;
  if (game === "mines") {
    result = await ctx.service.startMines({
      userId: interaction.user.id,
      wager,
      channelId,
      mineCount: interaction.options.getInteger("mines") ?? undefined,
    });
  } else if (game === "appletower") {
    result = await ctx.service.startAppleTower({ userId: interaction.user.id, wager, channelId });
  } else {
    result = await ctx.service.startBlackjack({ userId: interaction.user.id, wager, channelId });
  }
  if (!result.ok) {
    await privateError(interaction, result.message);
    return;
  }
  await interaction.editReply(renderGame(result.view, await renderContext(ctx)));
}

// ------------------------------------------------------------ economy-admin

async function handleEconomyAdmin(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  // Checked on the server every time, whatever the command menu showed.
  if (!isAdmin(interaction, ctx.config)) {
    await interaction.reply({ content: "Only administrators can use this command.", ephemeral: true });
    return;
  }
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "image-view") {
    const { url, source } = await ctx.images.resolve();
    if (!url) {
      await interaction.reply({
        content: "No currency image is set. Everything works with plain DH text. Use `/economy-admin image-set` to add one.",
        ephemeral: true,
      });
      return;
    }
    const where = source === "admin" ? "set with /economy-admin" : "from the CURRENCY_IMAGE_URL setting";
    await interaction.reply({
      content: `Current currency image (${where}): <${url}>`,
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setImage(url)],
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "image-set") {
    await interaction.deferReply({ ephemeral: true });
    const url = interaction.options.getString("url", true);
    const result = await ctx.images.set(url, interaction.user.id);
    if (!result.ok) {
      await interaction.editReply(`❌ ${result.error} The current image was not changed.`);
      return;
    }
    logger.info(
      { adminId: interaction.user.id, action: "currency-image-set", host: new URL(result.url).hostname },
      "Currency image changed.",
    );
    await interaction.editReply({
      content: "✅ Currency image saved. It is now used everywhere.",
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setImage(result.url)],
    });
    return;
  }

  if (subcommand === "image-clear") {
    await ctx.images.clear(interaction.user.id);
    logger.info({ adminId: interaction.user.id, action: "currency-image-clear" }, "Currency image cleared.");
    const { url } = await ctx.images.resolve();
    await interaction.reply({
      content: url
        ? "✅ The saved image was removed. The image from the CURRENCY_IMAGE_URL setting is used instead."
        : "✅ The currency image was removed. DH text is shown instead.",
      ephemeral: true,
    });
    return;
  }

  if (subcommand === "give" || subcommand === "take") {
    const giving = subcommand === "give";
    const target = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    if (target.bot) {
      await interaction.reply({ content: "❌ Bots do not have wallets.", ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const change = { adminId: interaction.user.id, userId: target.id, amount };
    const result = giving ? await ctx.service.adminGive(change) : await ctx.service.adminTake(change);
    if (!result.ok) {
      await interaction.editReply(`❌ ${result.message}`);
      return;
    }
    logger.info(
      {
        adminId: interaction.user.id,
        targetId: target.id,
        amount: result.amount,
        action: giving ? "economy-give" : "economy-take",
      },
      giving ? "An admin added Dirhams to a wallet." : "An admin removed Dirhams from a wallet.",
    );
    await interaction.editReply({
      content: giving
        ? `✅ Added ${formatDh(result.amount, ctx.config)} to <@${target.id}>. New balance: ${formatDh(result.balance, ctx.config)}.`
        : `✅ Removed ${formatDh(result.amount, ctx.config)} from <@${target.id}>. New balance: ${formatDh(result.balance, ctx.config)}.`,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
}

// ------------------------------------------------------------- leaderboard

const VOICE_LEADERBOARD_DEPTH = 100;
/** Only the top 100 richest members are listed (14 pages), like the voice leaderboard. */
const RICHEST_DEPTH = 100;
const LEADERBOARD_CARD_FILE = "leaderboard-card.png";
const MONEY_CARD_FILE = "top-money-card.png";

type MemberCardInfo = { name: string; username: string | null; avatarUrl: string | null };

/** Names, @usernames and avatar links for a set of members (former members get a plain label). */
async function resolveMemberCardInfo(
  guild: Guild,
  ids: string[],
): Promise<Map<string, MemberCardInfo>> {
  const names = await resolveNames(guild, ids);
  const info = new Map<string, MemberCardInfo>();
  for (const id of ids) {
    const member = guild.members.cache.get(id);
    info.set(id, {
      name: names.get(id) ?? "Former member",
      username: member?.user.username ?? null,
      avatarUrl: member ? member.displayAvatarURL({ extension: "png", size: 128 }) : null,
    });
  }
  return info;
}

/** The viewer's total voice time, including a session that is still running. */
async function viewerVoiceSeconds(
  userId: string,
  topEntries: Array<{ discordUserId: string; value: number }>,
  now: Date,
): Promise<number> {
  const inTop = topEntries.find((entry) => entry.discordUserId === userId);
  if (inTop) {
    return inTop.value;
  }
  const [user, session] = await Promise.all([getUserData(userId), getActiveVoiceSession(userId)]);
  const running = session?.startedAt
    ? Math.max(0, Math.floor((now.getTime() - session.startedAt.getTime()) / 1000))
    : 0;
  return (user?.totalVoiceTimeSeconds ?? 0) + running;
}

/** Renders one page of the voice leaderboard as a card, or throws if it cannot be drawn. */
async function renderVoiceLeaderboardCard(
  guild: Guild,
  entries: Array<{ discordUserId: string; value: number }>,
  page: number,
  pages: number,
  viewerId: string,
  now: Date,
): Promise<AttachmentBuilder> {
  // The overall top three stay on the left of every page; the rows on the right
  // continue where the previous page stopped (4-10, then 11-17, then 18-24, ...).
  const { start, end } = leaderboardRowRange(page);
  const podiumEntries = entries.slice(0, LEADERBOARD_PODIUM_SIZE);
  const rowEntries = entries.slice(start, end);
  const shown = [...podiumEntries, ...rowEntries];
  const [info, viewerRank, viewerSeconds] = await Promise.all([
    resolveMemberCardInfo(guild, [...shown.map((entry) => entry.discordUserId), viewerId]),
    getVoiceTimeRank(viewerId, now),
    viewerVoiceSeconds(viewerId, entries, now),
  ]);
  const toMember = (entry: { discordUserId: string; value: number }, rank: number) => {
    const who = info.get(entry.discordUserId);
    return {
      rank,
      displayName: who?.name ?? "Former member",
      username: who?.username ?? null,
      seconds: entry.value,
      avatarUrl: who?.avatarUrl ?? null,
    };
  };
  const podium = podiumEntries.map((entry, index) => toMember(entry, index + 1));
  const rows = rowEntries.map((entry, index) => toMember(entry, start + index + 1));
  const me = info.get(viewerId);
  const png = await renderLeaderboardCard({
    serverName: LEADERBOARD_SERVER_LABEL,
    page,
    pages,
    podium,
    rows,
    viewer: {
      rank: viewerRank ?? 0,
      displayName: me?.name ?? "Member",
      username: me?.username ?? null,
      seconds: viewerSeconds,
      avatarUrl: me?.avatarUrl ?? null,
    },
  });
  return new AttachmentBuilder(png, { name: LEADERBOARD_CARD_FILE });
}

type RankedWallet = { entry: { discordUserId: string; balance: number }; rank: number };

/** Renders one page of the richest-members card, or throws if it cannot be drawn. */
async function renderRichestCard(
  ctx: EconomyContext,
  guild: Guild,
  ranked: RankedWallet[],
  page: number,
  pages: number,
  viewerId: string,
): Promise<AttachmentBuilder> {
  const [info, viewerRank, viewerBalance] = await Promise.all([
    resolveMemberCardInfo(guild, [...ranked.map(({ entry }) => entry.discordUserId), viewerId]),
    ctx.service.store.getWalletRank(viewerId),
    ctx.service.getBalance(viewerId),
  ]);
  const members = ranked.map(({ entry, rank }) => {
    const who = info.get(entry.discordUserId);
    return {
      rank,
      displayName: who?.name ?? "Former member",
      username: who?.username ?? null,
      balance: entry.balance,
      avatarUrl: who?.avatarUrl ?? null,
    };
  });
  const me = info.get(viewerId);
  const png = await renderMoneyLeaderboardCard({
    serverName: LEADERBOARD_SERVER_LABEL,
    currencySymbol: ctx.config.currencySymbol,
    page,
    pages,
    // The overall top three stay on the left of every page; the rows continue
    // where the previous page stopped (4-10, then 11-17, then 18-24, ...).
    podium: members.filter((member) => member.rank <= LEADERBOARD_PODIUM_SIZE),
    rows: members.filter((member) => member.rank > LEADERBOARD_PODIUM_SIZE),
    viewer: {
      rank: viewerRank ?? 0,
      displayName: me?.name ?? "Member",
      username: me?.username ?? null,
      balance: viewerBalance,
      avatarUrl: me?.avatarUrl ?? null,
    },
  });
  return new AttachmentBuilder(png, { name: MONEY_CARD_FILE });
}

type RichestPage = {
  total: number;
  page: number;
  pages: number;
  /** The picture; null when there is nothing to show or it could not be drawn. */
  card: AttachmentBuilder | null;
  /** Text lines used instead of the picture. */
  rows: Array<{ id: string; text: string }>;
};

/** One page of the richest members: the picture, or text lines if drawing fails. */
async function loadRichestPage(
  ctx: EconomyContext,
  guild: Guild,
  requestedPage: number,
  viewerId: string,
): Promise<RichestPage> {
  const entries = await ctx.service.store.getRichest(RICHEST_DEPTH, 0);
  const total = entries.length;
  const pages = leaderboardPageCount(total);
  const page = Math.min(Math.max(0, requestedPage), pages - 1);
  const { start, end } = leaderboardRowRange(page);
  const ranked: RankedWallet[] = [
    ...entries.slice(0, LEADERBOARD_PODIUM_SIZE).map((entry, index) => ({ entry, rank: index + 1 })),
    ...entries.slice(start, end).map((entry, index) => ({ entry, rank: start + index + 1 })),
  ];

  let card: AttachmentBuilder | null = null;
  if (total > 0) {
    try {
      card = await renderRichestCard(ctx, guild, ranked, page, pages, viewerId);
    } catch (error) {
      logger.error({ err: error }, "Could not draw the money leaderboard card; sending the text list.");
    }
  }

  let rows: Array<{ id: string; text: string }> = [];
  if (!card) {
    const names = await resolveNames(guild, ranked.map(({ entry }) => entry.discordUserId));
    rows = ranked.map(({ entry, rank }) => ({
      id: entry.discordUserId,
      text: `**${rank}.** ${names.get(entry.discordUserId)} — ${formatDhWithEmoji(entry.balance, ctx.config)}`,
    }));
  }
  return { total, page, pages, card, rows };
}

async function buildLeaderboardPage(
  ctx: EconomyContext,
  guild: Guild,
  requestedPage: number,
  userId: string,
) {
  const render = await renderContext(ctx);
  let rows: Array<{ id: string; text: string }> = [];
  let total = 0;
  let page = Math.max(0, requestedPage);
  let card: AttachmentBuilder | null = null;

  {
    const now = new Date();
    const entries = await getVoiceTimeLeaderboardData(VOICE_LEADERBOARD_DEPTH, now);
    total = entries.length;
    page = Math.min(page, leaderboardPageCount(total) - 1);
    const pages = leaderboardPageCount(total);
    if (total > 0) {
      // Preferred reply: the leaderboard as a picture. If drawing fails for any
      // reason, the text list below is sent instead so /leaderboard always answers.
      try {
        card = await renderVoiceLeaderboardCard(guild, entries, page, pages, userId, now);
      } catch (error) {
        logger.error({ err: error }, "Could not draw the leaderboard card; sending the text list.");
      }
    }
    if (!card) {
      // Same split as the card: the top three, then this page's rows.
      const { start, end } = leaderboardRowRange(page);
      const ranked = [
        ...entries.slice(0, LEADERBOARD_PODIUM_SIZE).map((entry, index) => ({ entry, rank: index + 1 })),
        ...entries.slice(start, end).map((entry, index) => ({ entry, rank: start + index + 1 })),
      ];
      const names = await resolveNames(guild, ranked.map(({ entry }) => entry.discordUserId));
      rows = ranked.map(({ entry, rank }) => ({
        id: entry.discordUserId,
        text: `**${rank}.** ${names.get(entry.discordUserId)} — ${formatVoiceDuration(entry.value)}`,
      }));
    }
  }

  const pages = leaderboardPageCount(total);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lb|${userId}|voice|${page - 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("◀ Previous")
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`lb|${userId}|voice|${page + 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Next ▶")
      .setDisabled(page >= pages - 1),
  );

  // Every reply sets content, embeds and attachments, so switching between the
  // card and the text list never leaves the other one behind.
  if (card) {
    return {
      content: "",
      embeds: [] as EmbedBuilder[],
      files: [card],
      attachments: [] as never[],
      components: [buttons],
    };
  }

  const embed = baseEmbed(render, "🎙️ Voice activity leaderboard")
    .setDescription(rows.length > 0 ? rows.map((row) => row.text).join("\n") : "Nothing to show yet.")
    .setFooter({
      text: `Page ${page + 1}/${pages} · top ${VOICE_LEADERBOARD_DEPTH} · voice time includes AFK channels`,
    });
  return {
    content: "",
    embeds: [embed],
    files: [] as AttachmentBuilder[],
    attachments: [] as never[],
    components: [buttons],
  };
}

async function handleLeaderboard(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  await interaction.deferReply();
  await interaction.editReply(await buildLeaderboardPage(ctx, guild, 0, interaction.user.id));
}

/** The /topmoney reply: the richest-members card with Previous / Next buttons. */
async function buildTopMoneyPage(ctx: EconomyContext, guild: Guild, requestedPage: number, userId: string) {
  const richest = await loadRichestPage(ctx, guild, requestedPage, userId);
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tm|${userId}|${richest.page - 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("◀ Previous")
      .setDisabled(richest.page <= 0),
    new ButtonBuilder()
      .setCustomId(`tm|${userId}|${richest.page + 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Next ▶")
      .setDisabled(richest.page >= richest.pages - 1),
  );

  if (richest.card) {
    return {
      content: "",
      embeds: [] as EmbedBuilder[],
      files: [richest.card],
      attachments: [] as never[],
      components: [buttons],
    };
  }

  const embed = baseEmbed(await renderContext(ctx), `${ctx.config.currencyEmoji} Richest members`)
    .setDescription(richest.rows.length > 0 ? richest.rows.map((row) => row.text).join("\n") : "Nothing to show yet.")
    .setFooter({ text: `Page ${richest.page + 1}/${richest.pages} · ${ctx.config.currencyName} balances` });
  return {
    content: "",
    embeds: [embed],
    files: [] as AttachmentBuilder[],
    attachments: [] as never[],
    components: [buttons],
  };
}

async function handleTopMoney(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  await interaction.deferReply();
  await interaction.editReply(await buildTopMoneyPage(ctx, guild, 0, interaction.user.id));
}

// ----------------------------------------------------------------- routing

export async function handleEconomyCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!ECONOMY_COMMAND_NAMES.has(interaction.commandName)) {
    return false;
  }
  const ctx = getEconomyContext();
  if (!ctx) {
    return false;
  }
  if (!interaction.guild || !isTargetGuild(interaction.guildId, ctx.config)) {
    await interaction.reply({
      content: "This bot only works in its own server.",
      ephemeral: true,
    });
    return true;
  }
  const guild = interaction.guild;

  const commandName = interaction.commandName;
  try {
    switch (commandName) {
      case "help":
        await handleHelp(interaction, ctx);
        break;
      case "balance":
        await handleBalance(interaction, ctx, guild);
        break;
      case "transfer":
        await handlePay(interaction, ctx, guild);
        break;
      case "work":
        await handleCooldownReward(interaction, ctx, "work");
        break;
      case "daily":
        await handleCooldownReward(interaction, ctx, "daily");
        break;
      case "coinflip":
        await handleCoinflip(interaction, ctx);
        break;
      case "mines":
      case "blackjack":
      case "appletower":
        await handleGameStart(interaction, ctx, commandName);
        break;
      case "leaderboard":
        await handleLeaderboard(interaction, ctx, guild);
        break;
      case "topmoney":
        await handleTopMoney(interaction, ctx, guild);
        break;
      case "economy-admin":
        await handleEconomyAdmin(interaction, ctx);
        break;
      case SHOP_COMMAND_NAME:
        await handleShopCommand(interaction, ctx, guild);
        break;
      case WARDROBE_COMMAND_NAME:
        await handleWardrobeCommand(interaction, ctx, guild);
        break;
      case SHOP_ADMIN_COMMAND_NAME:
        await handleShopAdminCommand(interaction, ctx, guild);
        break;
      case WEEKLY_COMMAND_NAME:
        await handleWeeklyTaskCommand(interaction, ctx, guild);
        break;
      case "guessflag":
      case "guessmap":
      case "guesslogo":
        await handleQuizCommand(interaction, ctx);
        break;
    }
  } catch (error) {
    logger.error(
      { err: error, commandName: interaction.commandName },
      "Could not complete an economy slash command.",
    );
    const message = "Something went wrong. Please try again in a moment.";
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message, embeds: [], components: [] });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    } catch {
      logger.warn({ commandName: interaction.commandName }, "Could not send the economy error response.");
    }
  }
  return true;
}

async function handleLeaderboardComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ctx: EconomyContext,
  guild: Guild,
) {
  const parts = interaction.customId.split("|");
  const ownerId = parts[1];
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Use /leaderboard to open your own copy.",
      ephemeral: true,
    });
    return;
  }
  // The leaderboard is voice only. Old messages that still have the category
  // menu just show the voice leaderboard again.
  let page = 0;
  if (!interaction.isStringSelectMenu()) {
    page = Number.parseInt(parts[3] ?? "0", 10);
    if (!Number.isInteger(page) || page < 0) {
      page = 0;
    }
  }
  await interaction.deferUpdate();
  await interaction.editReply(await buildLeaderboardPage(ctx, guild, page, ownerId));
}

async function handleTopMoneyComponent(interaction: ButtonInteraction, ctx: EconomyContext, guild: Guild) {
  const [, ownerId, rawPage] = interaction.customId.split("|");
  if (ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Use /topmoney to open your own copy.",
      ephemeral: true,
    });
    return;
  }
  let page = Number.parseInt(rawPage ?? "0", 10);
  if (!Number.isInteger(page) || page < 0) {
    page = 0;
  }
  await interaction.deferUpdate();
  await interaction.editReply(await buildTopMoneyPage(ctx, guild, page, ownerId));
}

async function handleGameComponent(interaction: ButtonInteraction, ctx: EconomyContext) {
  const [, kind, gameId, action, arg] = interaction.customId.split("|");
  if (!gameId || !action) {
    return;
  }
  await interaction.deferUpdate();
  const userId = interaction.user.id;
  let result: GameActionResult | null = null;

  if (kind === "m") {
    result =
      action === "r"
        ? await ctx.service.minesReveal(gameId, userId, Number.parseInt(arg ?? "", 10))
        : action === "c"
          ? await ctx.service.minesCashout(gameId, userId)
          : null;
  } else if (kind === "a") {
    result =
      action === "p"
        ? await ctx.service.towerPick(gameId, userId, Number.parseInt(arg ?? "", 10))
        : action === "c"
          ? await ctx.service.towerCashout(gameId, userId)
          : null;
  } else if (kind === "b") {
    result =
      action === "h"
        ? await ctx.service.blackjackHit(gameId, userId)
        : action === "s"
          ? await ctx.service.blackjackStand(gameId, userId)
          : null;
  }
  if (!result) {
    return;
  }

  if (result.ok) {
    await interaction.editReply(renderGame(result.view, await renderContext(ctx)));
    return;
  }
  await interaction.followUp({ content: result.message, ephemeral: true });
  if (result.reason === "expired" || result.reason === "already_settled" || result.reason === "not_found") {
    // The game is over; remove its stale buttons (only the owner reaches here).
    await interaction.editReply({ components: [] }).catch(() => undefined);
  }
}

/** Returns true when the interaction belonged to the economy. */
export async function handleEconomyComponent(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton() && !interaction.isStringSelectMenu()) {
    return false;
  }
  const id = interaction.customId;
  const isGame = id.startsWith("g|");
  const isLeaderboard = id.startsWith("lb|") || id.startsWith("lbs|");
  const isTopMoney = id.startsWith("tm|");
  const isQuiz = id.startsWith(QUIZ_BUTTON_PREFIX);
  const isShop = id.startsWith(SHOP_BUTTON_PREFIX);
  const isWardrobe = id.startsWith(WARDROBE_BUTTON_PREFIX);
  const isWeekly = id.startsWith(WEEKLY_BUTTON_PREFIX);
  if (!isGame && !isLeaderboard && !isTopMoney && !isQuiz && !isShop && !isWardrobe && !isWeekly) {
    return false;
  }
  const ctx = getEconomyContext();
  if (!ctx) {
    return false;
  }
  if (!interaction.guild || !isTargetGuild(interaction.guildId, ctx.config)) {
    return true;
  }
  try {
    if (isGame && interaction.isButton()) {
      await handleGameComponent(interaction, ctx);
    } else if (isLeaderboard) {
      await handleLeaderboardComponent(interaction, ctx, interaction.guild);
    } else if (isTopMoney && interaction.isButton()) {
      await handleTopMoneyComponent(interaction, ctx, interaction.guild);
    } else if (isQuiz && interaction.isButton()) {
      await handleQuizComponent(interaction, ctx);
    } else if (isShop) {
      await handleShopComponent(interaction, ctx, interaction.guild);
    } else if (isWeekly && interaction.isButton()) {
      await handleWeeklyTaskComponent(interaction, ctx);
    } else if (isWardrobe) {
      await handleWardrobeComponent(interaction, ctx, interaction.guild);
    }
  } catch (error) {
    logger.error({ err: error }, "Could not complete an economy button interaction.");
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: "Something went wrong. Please try again.", ephemeral: true });
      } else {
        await interaction.reply({ content: "Something went wrong. Please try again.", ephemeral: true });
      }
    } catch {
      /* nothing more to do */
    }
  }
  return true;
}
