import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type StringSelectMenuInteraction,
} from "discord.js";
import { logger } from "../config/logger.js";
import type { EconomyContext } from "../economy/context.js";
import type { EconomyConfig } from "../economy/economy-config.js";
import { formatDh } from "../economy/format.js";
import { LEADERBOARD_SERVER_LABEL } from "../leaderboard/leaderboard-card-data.js";
import { renderShopCard } from "../shop/shop-card.js";
import {
  clampShopPage,
  shopPageCount,
  shopPageItems,
  type ShopCardItem,
  type ShopItemState,
} from "../shop/shop-card-data.js";
import {
  SHOP_BUTTON_PREFIX,
  WARDROBE_BUTTON_PREFIX,
  parseShopId,
  parseWardrobeId,
  shopIds,
  wardrobeIds,
} from "../shop/shop-ids.js";
import type { ShopItem } from "../shop/shop-rules.js";

export const SHOP_COMMAND_NAME = "shop";
export const WARDROBE_COMMAND_NAME = "wardrobe";
export { SHOP_BUTTON_PREFIX, WARDROBE_BUTTON_PREFIX };

const GOLD = 0xf1c40f;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;

export function buildShopCommandBuilder(config: EconomyConfig) {
  return new SlashCommandBuilder()
    .setName(SHOP_COMMAND_NAME)
    .setDescription(`Buy name colors with ${config.currencyNamePlural}.`);
}

type ShopInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction;

/** Every shop reply sets all four fields, so switching views never leaves an old card behind. */
type ShopReply = {
  content: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  attachments: never[];
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
};

function viewerName(interaction: ShopInteraction): string {
  const member = interaction.member;
  if (member && "displayName" in member && typeof member.displayName === "string") {
    return member.displayName;
  }
  return interaction.user.globalName ?? interaction.user.username;
}

function liveColor(guild: Guild, item: ShopItem): number {
  return guild.roles.cache.get(item.roleId)?.color ?? item.color;
}

function itemState(item: ShopItem, ownedIds: ReadonlySet<string>, wornId: string | null): ShopItemState {
  if (item.id === wornId) {
    return "worn";
  }
  return ownedIds.has(item.id) ? "owned" : "for_sale";
}

function cut(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------- the shop

async function buildShopPage(
  ctx: EconomyContext,
  guild: Guild,
  requestedPage: number,
  userId: string,
  name: string,
): Promise<ShopReply> {
  const [items, owned, worn, balance] = await Promise.all([
    ctx.shop.listItems(),
    ctx.shop.listOwned(userId),
    ctx.shop.wornItem(userId),
    ctx.service.getBalance(userId),
  ]);
  const page = clampShopPage(requestedPage, items.length);
  const pages = shopPageCount(items.length);
  const ownedIds = new Set(owned.map((item) => item.id));
  const pageItems = shopPageItems(items, page);

  const cardItems: ShopCardItem[] = pageItems.map((item) => ({
    name: item.name,
    description: item.description,
    price: item.price,
    color: liveColor(guild, item),
    state: itemState(item, ownedIds, worn?.id ?? null),
  }));

  const components: ShopReply["components"] = [];
  if (pageItems.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(shopIds.pick(userId, page))
      .setPlaceholder("Choose a color…")
      .addOptions(
        pageItems.map((item, index) => {
          const state = itemState(item, ownedIds, worn?.id ?? null);
          const status = state === "worn" ? "wearing" : state === "owned" ? "owned" : "for sale";
          return {
            label: cut(`${index + 1}. ${item.name}`, 100),
            description: cut(`${formatDh(item.price, ctx.config)} · ${status}`, 100),
            value: item.id,
          };
        }),
      );
    components.push(new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(menu));
  }
  if (pages > 1) {
    components.push(
      new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(shopIds.page(userId, page - 1))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("◀ Previous")
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(shopIds.page(userId, page + 1))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Next ▶")
          .setDisabled(page >= pages - 1),
      ),
    );
  }

  let card: AttachmentBuilder | null = null;
  try {
    const png = await renderShopCard({
      serverName: LEADERBOARD_SERVER_LABEL,
      currencySymbol: ctx.config.currencySymbol,
      page,
      totalItems: items.length,
      items: cardItems,
      balance,
      viewerName: name,
    });
    card = new AttachmentBuilder(png, { name: "shop.png" });
  } catch (error) {
    logger.error({ err: error }, "Could not draw the shop card; sending the text list.");
  }

  if (card) {
    return { content: "", embeds: [], files: [card], attachments: [], components };
  }

  // Fallback so /shop always answers, even if drawing fails.
  const lines = pageItems.map((item, index) => {
    const state = itemState(item, ownedIds, worn?.id ?? null);
    const tag = state === "worn" ? " — wearing" : state === "owned" ? " — owned" : "";
    return `**${index + 1}.** ${item.name} — ${formatDh(item.price, ctx.config)}${tag}`;
  });
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("🎨 Color shop")
    .setDescription(lines.length > 0 ? lines.join("\n") : "The shop is empty.")
    .setFooter({
      text: `Page ${page + 1}/${pages} · your balance: ${formatDh(balance, ctx.config)}`,
    });
  return { content: "", embeds: [embed], files: [], attachments: [], components };
}

// ------------------------------------------------------------ one color view

async function buildDetailPage(
  ctx: EconomyContext,
  guild: Guild,
  item: ShopItem,
  userId: string,
  page: number,
): Promise<ShopReply> {
  const [owned, worn, balance] = await Promise.all([
    ctx.shop.listOwned(userId),
    ctx.shop.wornItem(userId),
    ctx.service.getBalance(userId),
  ]);
  const state = itemState(item, new Set(owned.map((entry) => entry.id)), worn?.id ?? null);
  const color = liveColor(guild, item);

  const embed = new EmbedBuilder()
    .setColor(color === 0 ? GOLD : color)
    .setTitle(`🎨 ${item.name}`)
    .addFields(
      { name: "Price", value: formatDh(item.price, ctx.config), inline: true },
      { name: "Your balance", value: formatDh(balance, ctx.config), inline: true },
    );
  if (item.description) {
    embed.setDescription(item.description);
  }

  const buttons = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();
  if (state === "worn") {
    embed.addFields({ name: "Status", value: "You are wearing this color.", inline: false });
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(shopIds.off(userId, page))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Take it off"),
    );
  } else if (state === "owned") {
    embed.addFields({ name: "Status", value: "You own this color. Putting it on is free.", inline: false });
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(shopIds.wear(userId, page, item.id))
        .setStyle(ButtonStyle.Success)
        .setLabel("Put it on"),
    );
  } else {
    const affordable = balance >= item.price;
    embed.addFields({
      name: "Status",
      value: affordable
        ? "Buying it is permanent: you can switch between your colors for free."
        : `You need ${formatDh(item.price - balance, ctx.config)} more.`,
      inline: false,
    });
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(shopIds.buy(userId, page, item.id, item.price))
        .setStyle(ButtonStyle.Success)
        .setLabel(`Buy for ${formatDh(item.price, ctx.config)}`)
        .setDisabled(!affordable),
    );
  }
  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(shopIds.back(userId, page))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Back to the shop"),
  );
  return { content: "", embeds: [embed], files: [], attachments: [], components: [buttons] };
}

/** A short result message (bought, failed, put on...) with a way back. */
function buildResultPage(userId: string, page: number, title: string, description: string, color: number): ShopReply {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
  const buttons = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(shopIds.back(userId, page))
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Back to the shop"),
  );
  return { content: "", embeds: [embed], files: [], attachments: [], components: [buttons] };
}

// ------------------------------------------------------------------ handlers

export async function handleShopCommand(
  interaction: ChatInputCommandInteraction,
  ctx: EconomyContext,
  guild: Guild,
): Promise<void> {
  await interaction.deferReply();
  await interaction.editReply(
    await buildShopPage(ctx, guild, 0, interaction.user.id, viewerName(interaction)),
  );
}

/** Buttons and the menu of the shop. Only the member who opened it can use them. */
export async function handleShopComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ctx: EconomyContext,
  guild: Guild,
): Promise<void> {
  const action = parseShopId(interaction.customId);
  if (!action) {
    return;
  }
  if (action.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Use /shop to open your own copy.",
      ephemeral: true,
    });
    return;
  }
  const userId = interaction.user.id;
  const name = viewerName(interaction);
  await interaction.deferUpdate();

  const showShop = async (page: number) =>
    interaction.editReply(await buildShopPage(ctx, guild, page, userId, name));

  if (action.kind === "page" || action.kind === "back") {
    await showShop(action.page);
    return;
  }

  if (action.kind === "pick") {
    const itemId = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    const item = itemId ? await ctx.shop.getItem(itemId) : null;
    if (!item || item.archived) {
      await showShop(action.page);
      await interaction.followUp({ content: "That color is no longer for sale.", ephemeral: true });
      return;
    }
    await interaction.editReply(await buildDetailPage(ctx, guild, item, userId, action.page));
    return;
  }

  if (action.kind === "buy") {
    const outcome = await ctx.shop.buy({ userId, itemId: action.itemId, expectedPrice: action.price });
    if (!outcome.ok) {
      await interaction.editReply(
        buildResultPage(userId, action.page, "Not bought", outcome.message, RED),
      );
      return;
    }
    const lines = [
      `You bought **${outcome.item.name}** for ${formatDh(outcome.pricePaid, ctx.config)}.`,
      `New balance: ${formatDh(outcome.balance, ctx.config)}.`,
      outcome.equipped
        ? "The color is on. You can switch between your colors for free."
        : `${outcome.equipMessage ?? "I could not put the color on right now."} You still own it, and you can put it on later for free.`,
    ];
    await interaction.editReply(
      buildResultPage(userId, action.page, "🎨 Purchase complete", lines.join("\n"), outcome.equipped ? GREEN : GOLD),
    );
    return;
  }

  if (action.kind === "wear") {
    const outcome = await ctx.shop.equip(userId, action.itemId);
    await interaction.editReply(
      outcome.ok
        ? buildResultPage(userId, action.page, "🎨 Color on", `**${outcome.item.name}** is now your name color.`, GREEN)
        : buildResultPage(userId, action.page, "Could not put it on", outcome.message, RED),
    );
    return;
  }

  // action.kind === "off"
  const outcome = await ctx.shop.unequip(userId);
  await interaction.editReply(
    outcome.ok
      ? buildResultPage(userId, action.page, "🎨 Color off", "Your shop color is off. You still own it.", GOLD)
      : buildResultPage(userId, action.page, "Could not take it off", outcome.message, RED),
  );
}


// ----------------------------------------------------------------- wardrobe

export function buildWardrobeCommandBuilder() {
  return new SlashCommandBuilder()
    .setName(WARDROBE_COMMAND_NAME)
    .setDescription("Put on or take off the name colors you own.");
}

/**
 * The member's own colors as a card. Choosing one in the menu puts it on at
 * once (free); the Take off button removes it. Colors that were taken off sale
 * are still listed, because buying is permanent.
 */
async function buildWardrobePage(
  ctx: EconomyContext,
  guild: Guild,
  requestedPage: number,
  userId: string,
  name: string,
): Promise<ShopReply> {
  const [owned, worn, balance] = await Promise.all([
    ctx.shop.listOwned(userId),
    ctx.shop.wornItem(userId),
    ctx.service.getBalance(userId),
  ]);
  const page = clampShopPage(requestedPage, owned.length);
  const pages = shopPageCount(owned.length);
  const pageItems = shopPageItems(owned, page);
  const wornId = worn?.id ?? null;

  const cardItems: ShopCardItem[] = pageItems.map((item) => ({
    name: item.name,
    description: item.description,
    price: item.price,
    color: liveColor(guild, item),
    state: item.id === wornId ? "worn" : "owned",
  }));

  const components: ShopReply["components"] = [];
  if (pageItems.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(wardrobeIds.pick(userId, page))
      .setPlaceholder("Choose a color to put on…")
      .addOptions(
        pageItems.map((item, index) => ({
          label: cut(`${index + 1}. ${item.name}`, 100),
          description: item.id === wornId ? "wearing now" : "free to put on",
          value: item.id,
        })),
      );
    components.push(new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>().addComponents(menu));

    const buttons = new ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>();
    if (pages > 1) {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(wardrobeIds.page(userId, page - 1))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("◀ Previous")
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(wardrobeIds.page(userId, page + 1))
          .setStyle(ButtonStyle.Secondary)
          .setLabel("Next ▶")
          .setDisabled(page >= pages - 1),
      );
    }
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(wardrobeIds.off(userId, page))
        .setStyle(ButtonStyle.Danger)
        .setLabel("Take off")
        .setDisabled(!worn),
    );
    components.push(buttons);
  }

  let card: AttachmentBuilder | null = null;
  try {
    const png = await renderShopCard({
      mode: "wardrobe",
      serverName: LEADERBOARD_SERVER_LABEL,
      currencySymbol: ctx.config.currencySymbol,
      page,
      totalItems: owned.length,
      items: cardItems,
      balance,
      viewerName: name,
    });
    card = new AttachmentBuilder(png, { name: "wardrobe.png" });
  } catch (error) {
    logger.error({ err: error }, "Could not draw the wardrobe card; sending the text list.");
  }
  if (card) {
    return { content: "", embeds: [], files: [card], attachments: [], components };
  }

  const lines = pageItems.map(
    (item, index) => `**${index + 1}.** ${item.name}${item.id === wornId ? " — wearing" : ""}`,
  );
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("👗 Wardrobe")
    .setDescription(
      lines.length > 0 ? lines.join("\n") : "You do not own any colors yet. Buy one with /shop.",
    )
    .setFooter({ text: `Page ${page + 1}/${pages}` });
  return { content: "", embeds: [embed], files: [], attachments: [], components };
}

export async function handleWardrobeCommand(
  interaction: ChatInputCommandInteraction,
  ctx: EconomyContext,
  guild: Guild,
): Promise<void> {
  await interaction.deferReply();
  await interaction.editReply(
    await buildWardrobePage(ctx, guild, 0, interaction.user.id, viewerName(interaction)),
  );
}

/** The wardrobe's buttons and menu. Only the member who opened it can use them. */
export async function handleWardrobeComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  ctx: EconomyContext,
  guild: Guild,
): Promise<void> {
  const action = parseWardrobeId(interaction.customId);
  if (!action) {
    return;
  }
  if (action.ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "Use /wardrobe to open your own copy.",
      ephemeral: true,
    });
    return;
  }
  const userId = interaction.user.id;
  const name = viewerName(interaction);
  await interaction.deferUpdate();

  let problem: string | null = null;
  if (action.kind === "pick") {
    const itemId = interaction.isStringSelectMenu() ? interaction.values[0] : undefined;
    if (itemId) {
      const outcome = await ctx.shop.equip(userId, itemId);
      problem = outcome.ok ? null : outcome.message;
    }
  } else if (action.kind === "off") {
    const outcome = await ctx.shop.unequip(userId);
    problem = outcome.ok ? null : outcome.message;
  }

  // Always redraw, so the badges show what the member really wears now.
  await interaction.editReply(await buildWardrobePage(ctx, guild, action.page, userId, name));
  if (problem) {
    await interaction.followUp({ content: problem, ephemeral: true });
  }
}
