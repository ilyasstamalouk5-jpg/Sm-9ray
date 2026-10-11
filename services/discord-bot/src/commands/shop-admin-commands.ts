import {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Role,
} from "discord.js";
import { logger } from "../config/logger.js";
import type { EconomyContext } from "../economy/context.js";
import type { EconomyConfig } from "../economy/economy-config.js";
import { formatDh } from "../economy/format.js";
import { isEconomyAdmin } from "../economy/permissions.js";
import {
  SHOP_DESCRIPTION_MAX_LENGTH,
  SHOP_MAX_ITEMS,
  SHOP_MAX_PRICE,
  SHOP_NAME_MAX_LENGTH,
  colorToHex,
  outrankingColoredRoles,
  roleSaleProblem,
  type RoleInfo,
  type ShopItem,
} from "../shop/shop-rules.js";

export const SHOP_ADMIN_COMMAND_NAME = "shop-config";

const GOLD = 0xf1c40f;
const RED = 0xe74c3c;

// --------------------------------------------------------------- builder

export function buildShopAdminCommandBuilder(config: EconomyConfig) {
  const builder = new SlashCommandBuilder()
    .setName(SHOP_ADMIN_COMMAND_NAME)
    .setDescription("Admin: choose which color roles are for sale and their prices.")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Put a color role on sale.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("The color role to sell.").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("price")
            .setDescription(`Price in ${config.currencyNamePlural} (1 to ${SHOP_MAX_PRICE.toLocaleString("en-US")}).`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(SHOP_MAX_PRICE),
        )
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Name shown in the shop (default: the role's name).")
            .setRequired(false)
            .setMaxLength(SHOP_NAME_MAX_LENGTH),
        )
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("Short text shown in the shop (optional).")
            .setRequired(false)
            .setMaxLength(SHOP_DESCRIPTION_MAX_LENGTH),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Change the price, name, text or position of a color in the shop.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("The color role to change.").setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("price")
            .setDescription("New price.")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(SHOP_MAX_PRICE),
        )
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("New name shown in the shop.")
            .setRequired(false)
            .setMaxLength(SHOP_NAME_MAX_LENGTH),
        )
        .addStringOption((option) =>
          option
            .setName("description")
            .setDescription("New text shown in the shop (type - to clear it).")
            .setRequired(false)
            .setMaxLength(SHOP_DESCRIPTION_MAX_LENGTH),
        )
        .addIntegerOption((option) =>
          option
            .setName("position")
            .setDescription("Where it appears in the shop (1 = first).")
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(SHOP_MAX_ITEMS),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Take a color off sale. Members who already bought it keep it.")
        .addRoleOption((option) =>
          option.setName("role").setDescription("The color role to remove.").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show every color in the shop with its price and owners."),
    )
    .addSubcommand((sub) =>
      sub
        .setName("check")
        .setDescription("Check that every color in the shop can really be given out."),
    );
  // Like /economy-admin: with no ADMIN_ROLE_ID only Administrators see it. With
  // one, everyone sees it and the bot checks the permission itself.
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

function toRoleInfo(role: Role, guild: Guild): RoleInfo {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    managed: role.managed,
    isEveryone: role.id === guild.id,
    permissionNames: role.permissions.toArray(),
    editable: role.editable,
  };
}

async function fetchRole(guild: Guild, roleId: string): Promise<Role | null> {
  return guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
}

/** Colored milestone/admin roles that sit above `role` and would hide its color. */
async function hiddenByRoles(guild: Guild, role: Role, ctx: EconomyContext): Promise<string[]> {
  const others: Array<{ name: string; position: number; color: number }> = [];
  for (const id of ctx.shop.reservedRoleIds()) {
    const other = await fetchRole(guild, id);
    if (other) {
      others.push({ name: other.name, position: other.position, color: other.color });
    }
  }
  return outrankingColoredRoles(role.position, others);
}

function describeItem(item: ShopItem, config: EconomyConfig): string {
  return `<@&${item.roleId}> · ${formatDh(item.price, config)}`;
}

function hiddenWarning(names: string[]): string {
  return `⚠️ In Server Settings > Roles, move this role **above** ${names.map((n) => `**${n}**`).join(", ")}. Members who have those roles will not see this color until you do.`;
}

function truncate(text: string, max = 4000): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// --------------------------------------------------------------- handlers

async function handleAdd(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  const picked = interaction.options.getRole("role", true);
  const role = await fetchRole(guild, picked.id);
  if (!role) {
    await interaction.editReply({ content: "I could not find that role." });
    return;
  }
  const result = await ctx.shop.addItem({
    adminId: interaction.user.id,
    role: toRoleInfo(role, guild),
    price: interaction.options.getInteger("price", true),
    name: interaction.options.getString("name"),
    description: interaction.options.getString("description"),
  });
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}` });
    return;
  }
  logger.info(
    { adminId: interaction.user.id, roleId: role.id, price: result.item.price },
    "Shop color added.",
  );
  const embed = new EmbedBuilder()
    .setColor(role.color || GOLD)
    .setTitle("✅ Added to the shop")
    .setDescription(describeItem(result.item, ctx.config))
    .addFields(
      { name: "Shown as", value: result.item.name, inline: true },
      { name: "Color", value: colorToHex(role.color), inline: true },
    );
  if (result.item.description) {
    embed.addFields({ name: "Text", value: result.item.description });
  }
  const hidden = await hiddenByRoles(guild, role, ctx);
  if (role.color === 0) {
    embed.addFields({
      name: "Heads up",
      value: "⚠️ This role has no color set, so it will not change anyone's name color. Set a color in Server Settings > Roles.",
    });
  }
  if (hidden.length > 0) {
    embed.addFields({ name: "Heads up", value: hiddenWarning(hidden) });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleEdit(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  const picked = interaction.options.getRole("role", true);
  const role = await fetchRole(guild, picked.id);
  if (!role) {
    await interaction.editReply({ content: "I could not find that role." });
    return;
  }
  const price = interaction.options.getInteger("price");
  const name = interaction.options.getString("name");
  const rawDescription = interaction.options.getString("description");
  const position = interaction.options.getInteger("position");
  if (price === null && name === null && rawDescription === null && position === null) {
    await interaction.editReply({
      content: "Choose at least one thing to change: price, name, description or position.",
    });
    return;
  }
  const result = await ctx.shop.editItem({
    role: toRoleInfo(role, guild),
    price,
    name,
    description: rawDescription === null ? null : rawDescription.trim() === "-" ? "" : rawDescription,
    position,
  });
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}` });
    return;
  }
  logger.info(
    { adminId: interaction.user.id, roleId: role.id, price: result.item.price },
    "Shop color edited.",
  );
  const embed = new EmbedBuilder()
    .setColor(role.color || GOLD)
    .setTitle("✏️ Shop color updated")
    .setDescription(describeItem(result.item, ctx.config))
    .addFields({ name: "Shown as", value: result.item.name, inline: true });
  if (result.item.description) {
    embed.addFields({ name: "Text", value: result.item.description });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function handleRemove(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  const picked = interaction.options.getRole("role", true);
  const result = await ctx.shop.removeItem(picked.id);
  if (!result.ok) {
    await interaction.editReply({ content: `❌ ${result.message}` });
    return;
  }
  logger.info({ adminId: interaction.user.id, roleId: picked.id }, "Shop color removed.");
  const owners =
    result.owners === 0
      ? "Nobody had bought it."
      : `${result.owners} member${result.owners === 1 ? "" : "s"} who bought it keep${result.owners === 1 ? "s" : ""} it and can still wear it.`;
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(RED)
        .setTitle("🗑️ Removed from the shop")
        .setDescription(`<@&${picked.id}> is no longer for sale.\n${owners}`),
    ],
  });
}

async function handleList(interaction: ChatInputCommandInteraction, ctx: EconomyContext) {
  const [items, owners] = await Promise.all([ctx.shop.listItems(), ctx.shop.ownerCounts()]);
  if (items.length === 0) {
    await interaction.editReply({
      content: "The shop is empty. Add a color with `/shop-config add role price`.",
    });
    return;
  }
  const lines = items.map((item, index) => {
    const count = owners.get(item.id) ?? 0;
    return `**${index + 1}.** ${describeItem(item, ctx.config)} · ${count} owner${count === 1 ? "" : "s"}`;
  });
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(GOLD)
        .setTitle(`🎨 Color shop (${items.length}/${SHOP_MAX_ITEMS})`)
        .setDescription(truncate(lines.join("\n"))),
    ],
  });
}

async function handleCheck(interaction: ChatInputCommandInteraction, ctx: EconomyContext, guild: Guild) {
  const items = await ctx.shop.listItems();
  if (items.length === 0) {
    await interaction.editReply({ content: "The shop is empty, so there is nothing to check." });
    return;
  }
  const reserved = ctx.shop.reservedRoleIds();
  const lines: string[] = [];
  let problems = 0;
  for (const item of items) {
    const role = await fetchRole(guild, item.roleId);
    if (!role) {
      problems += 1;
      lines.push(`❌ **${item.name}**: the role no longer exists. Remove it with \`/shop-config remove\`.`);
      continue;
    }
    const issues: string[] = [];
    const sale = roleSaleProblem(toRoleInfo(role, guild), reserved);
    if (sale) {
      issues.push(sale);
    }
    if (role.color === 0) {
      issues.push("The role has no color, so buying it changes nothing visible.");
    }
    const hidden = await hiddenByRoles(guild, role, ctx);
    if (hidden.length > 0) {
      issues.push(`Its color is hidden by higher colored roles: ${hidden.join(", ")}.`);
    }
    if (issues.length === 0) {
      lines.push(`✅ **${item.name}**: ready`);
    } else {
      problems += 1;
      lines.push(`⚠️ **${item.name}**: ${issues.join(" ")}`);
    }
  }
  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(problems === 0 ? 0x2ecc71 : RED)
        .setTitle(problems === 0 ? "✅ Every color is ready" : `⚠️ ${problems} color${problems === 1 ? "" : "s"} need attention`)
        .setDescription(truncate(lines.join("\n"))),
    ],
  });
}

export async function handleShopAdminCommand(
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
    await interaction.reply({
      content: "Only server administrators can use this command.",
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  switch (interaction.options.getSubcommand()) {
    case "add":
      await handleAdd(interaction, ctx, guild);
      break;
    case "edit":
      await handleEdit(interaction, ctx, guild);
      break;
    case "remove":
      await handleRemove(interaction, ctx);
      break;
    case "list":
      await handleList(interaction, ctx);
      break;
    case "check":
      await handleCheck(interaction, ctx, guild);
      break;
    default:
      await interaction.editReply({ content: "Unknown option." });
  }
}
