// Button and menu IDs of the member shop ("sh|") and the wardrobe ("wd|").
// Every ID carries the member who opened the screen, so only they can press
// its buttons. Pure functions, tested without Discord.

export const SHOP_BUTTON_PREFIX = "sh|";
export const WARDROBE_BUTTON_PREFIX = "wd|";

export type ShopAction =
  | { kind: "page"; ownerId: string; page: number }
  | { kind: "pick"; ownerId: string; page: number }
  | { kind: "buy"; ownerId: string; page: number; itemId: string; price: number }
  | { kind: "wear"; ownerId: string; page: number; itemId: string }
  | { kind: "off"; ownerId: string; page: number }
  | { kind: "back"; ownerId: string; page: number };

export const shopIds = {
  page: (ownerId: string, page: number) => `sh|${ownerId}|pg|${page}`,
  pick: (ownerId: string, page: number) => `sh|${ownerId}|pick|${page}`,
  buy: (ownerId: string, page: number, itemId: string, price: number) =>
    `sh|${ownerId}|buy|${itemId}|${price}|${page}`,
  wear: (ownerId: string, page: number, itemId: string) =>
    `sh|${ownerId}|wear|${itemId}|${page}`,
  off: (ownerId: string, page: number) => `sh|${ownerId}|off|${page}`,
  back: (ownerId: string, page: number) => `sh|${ownerId}|back|${page}`,
};

/** The wardrobe only pages, picks a color to put on, and takes it off. */
export const wardrobeIds = {
  page: (ownerId: string, page: number) => `wd|${ownerId}|pg|${page}`,
  pick: (ownerId: string, page: number) => `wd|${ownerId}|pick|${page}`,
  off: (ownerId: string, page: number) => `wd|${ownerId}|off|${page}`,
};

function wholeNumber(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function parseWithPrefix(customId: string, prefix: string, allowed: ReadonlySet<string>): ShopAction | null {
  if (!customId.startsWith(prefix)) {
    return null;
  }
  const parts = customId.split("|");
  const ownerId = parts[1];
  const action = parts[2];
  if (!ownerId || !action || !allowed.has(action)) {
    return null;
  }
  switch (action) {
    case "pg":
    case "pick":
    case "off":
    case "back": {
      const page = wholeNumber(parts[3]);
      if (parts.length !== 4 || page === null) {
        return null;
      }
      const kind = action === "pg" ? "page" : action;
      return { kind, ownerId, page };
    }
    case "buy": {
      const itemId = parts[3];
      const price = wholeNumber(parts[4]);
      const page = wholeNumber(parts[5]);
      if (parts.length !== 6 || !itemId || price === null || page === null) {
        return null;
      }
      return { kind: "buy", ownerId, page, itemId, price };
    }
    case "wear": {
      const itemId = parts[3];
      const page = wholeNumber(parts[4]);
      if (parts.length !== 5 || !itemId || page === null) {
        return null;
      }
      return { kind: "wear", ownerId, page, itemId };
    }
    default:
      return null;
  }
}

const SHOP_ACTIONS = new Set(["pg", "pick", "buy", "wear", "off", "back"]);
const WARDROBE_ACTIONS = new Set(["pg", "pick", "off"]);

/** Reads a shop ID. Returns null for anything that is not a well-formed one. */
export function parseShopId(customId: string): ShopAction | null {
  return parseWithPrefix(customId, SHOP_BUTTON_PREFIX, SHOP_ACTIONS);
}

/** Reads a wardrobe ID (page, pick or off only). */
export function parseWardrobeId(customId: string): ShopAction | null {
  return parseWithPrefix(customId, WARDROBE_BUTTON_PREFIX, WARDROBE_ACTIONS);
}
