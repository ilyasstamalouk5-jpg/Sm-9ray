// Pure rules for the color shop. No Discord or database imports, so this file
// can be tested on its own.

export const SHOP_MIN_PRICE = 1;
export const SHOP_MAX_PRICE = 1_000_000_000;
export const SHOP_MAX_ITEMS = 50;
export const SHOP_NAME_MAX_LENGTH = 32;
export const SHOP_DESCRIPTION_MAX_LENGTH = 80;

export type ShopItem = {
  id: string;
  roleId: string;
  name: string;
  description: string | null;
  price: number;
  /** Role color as 0xRRGGBB (0 = no color). */
  color: number;
  sortOrder: number;
  /** True when an admin removed it from sale. Members who bought it keep it. */
  archived: boolean;
};

/** What the bot needs to know about a Discord role before selling it. */
export type RoleInfo = {
  id: string;
  name: string;
  color: number;
  /** Created by a bot or integration (cannot be given to members by hand). */
  managed: boolean;
  isEveryone: boolean;
  /** Names such as "Administrator" or "ManageRoles". */
  permissionNames: readonly string[];
  /** The bot can assign this role (it has Manage Roles and ranks above it). */
  editable: boolean;
};

/**
 * A shop role must be cosmetic. If it carried moderation powers, anyone with
 * enough Dirhams could buy their way into them, so these are refused.
 */
export const ELEVATED_PERMISSIONS: ReadonlySet<string> = new Set([
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageMessages",
  "ManageNicknames",
  "ManageWebhooks",
  "ManageGuildExpressions",
  "ManageEvents",
  "ManageThreads",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "MentionEveryone",
  "MuteMembers",
  "DeafenMembers",
  "MoveMembers",
  "ViewAuditLog",
]);

export function elevatedPermissionsOf(names: readonly string[]): string[] {
  return names.filter((name) => ELEVATED_PERMISSIONS.has(name));
}

/**
 * Returns a plain-English reason why this role cannot be sold, or null when it
 * is fine. `reservedRoleIds` are roles that must never be sold (milestone
 * roles and the admin role).
 */
export function roleSaleProblem(
  role: RoleInfo,
  reservedRoleIds: readonly string[],
): string | null {
  if (role.isEveryone) {
    return "@everyone cannot be sold.";
  }
  if (role.managed) {
    return "That role is managed by a bot or integration, so it cannot be given to members.";
  }
  if (reservedRoleIds.includes(role.id)) {
    return "That role is a milestone or admin role. Create a separate color role for the shop.";
  }
  const elevated = elevatedPermissionsOf(role.permissionNames);
  if (elevated.length > 0) {
    return `That role has powerful permissions (${elevated.slice(0, 3).join(", ")}${elevated.length > 3 ? ", ..." : ""}). Shop roles must be cosmetic only, so remove those permissions first.`;
  }
  if (!role.editable) {
    return "I cannot assign that role. Give me the Manage Roles permission and move my role above it in Server Settings > Roles.";
  }
  return null;
}

export function priceProblem(price: number): string | null {
  if (!Number.isSafeInteger(price)) {
    return "The price must be a whole number.";
  }
  if (price < SHOP_MIN_PRICE || price > SHOP_MAX_PRICE) {
    return `The price must be between ${SHOP_MIN_PRICE.toLocaleString("en-US")} and ${SHOP_MAX_PRICE.toLocaleString("en-US")}.`;
  }
  return null;
}

/** Trims and checks a display name. Returns the clean name or an error. */
export function cleanShopName(
  raw: string,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0) {
    return { ok: false, message: "The name cannot be empty." };
  }
  if (name.length > SHOP_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `The name can be at most ${SHOP_NAME_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, name };
}

export function cleanShopDescription(
  raw: string,
): { ok: true; description: string | null } | { ok: false; message: string } {
  const description = raw.replace(/\s+/g, " ").trim();
  if (description.length > SHOP_DESCRIPTION_MAX_LENGTH) {
    return {
      ok: false,
      message: `The description can be at most ${SHOP_DESCRIPTION_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, description: description.length > 0 ? description : null };
}

export function colorToHex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

/**
 * Discord shows the name color of a member's HIGHEST role that has a color.
 * Returns the names of colored roles that sit above the shop role and would
 * therefore hide its color for members who also have them.
 */
export function outrankingColoredRoles(
  shopRolePosition: number,
  others: ReadonlyArray<{ name: string; position: number; color: number }>,
): string[] {
  return others
    .filter((other) => other.color !== 0 && other.position > shopRolePosition)
    .map((other) => other.name);
}
