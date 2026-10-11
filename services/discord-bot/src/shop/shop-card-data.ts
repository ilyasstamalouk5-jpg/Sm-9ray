// Turns the shop list into the exact strings the /shop card shows. Pure
// functions only, so wording, paging and edge cases are easy to test without
// drawing anything.

import { cardName } from "../leaderboard/leaderboard-card-data.js";
import { formatMoney } from "../leaderboard/money-leaderboard-card-data.js";
import { colorToHex } from "./shop-rules.js";

/** Colors shown on one page of the shop card (3 across, 2 down). */
export const SHOP_ITEMS_PER_PAGE = 6;

export function shopPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / SHOP_ITEMS_PER_PAGE));
}

/** Keeps a requested page inside 0 .. last page (bad input becomes page 0). */
export function clampShopPage(page: number, total: number): number {
  const last = shopPageCount(total) - 1;
  if (!Number.isInteger(page) || page < 0) {
    return 0;
  }
  return Math.min(page, last);
}

export function shopPageItems<T>(items: readonly T[], page: number): T[] {
  const safe = clampShopPage(page, items.length);
  const start = safe * SHOP_ITEMS_PER_PAGE;
  return items.slice(start, start + SHOP_ITEMS_PER_PAGE);
}

/** What the viewer can do with a color: buy it, or (once bought) wear it. */
export type ShopItemState = "for_sale" | "owned" | "worn";

export type ShopCardItem = {
  name: string;
  description: string | null;
  price: number;
  /** Role color as 0xRRGGBB (0 = no color). */
  color: number;
  state: ShopItemState;
};

/** The same card is used for the shop and for the member's own wardrobe. */
export type ShopCardMode = "shop" | "wardrobe";

export type ShopCardInput = {
  /** Defaults to "shop". */
  mode?: ShopCardMode;
  serverName: string;
  /** Short currency label drawn after every amount, for example "DH". */
  currencySymbol: string;
  /** Zero-based page index. */
  page: number;
  /** Total colors on sale across all pages. */
  totalItems: number;
  /** The colors of THIS page only, in shop order. */
  items: ShopCardItem[];
  /** The viewer's wallet. */
  balance: number;
  viewerName: string;
};

export type ShopCardTile = {
  /** Position on this page, starting at 1 (matches the menu below the card). */
  number: number;
  name: string;
  description: string | null;
  priceText: string;
  /** "#RRGGBB" for display or tests. */
  colorHex: string;
  /** 0xRRGGBB, or null when the role has no color. */
  color: number | null;
  state: ShopItemState;
  /** "OWNED", "WEARING" or null. */
  badge: string | null;
  /** False when the viewer cannot pay yet (only for colors not owned). */
  affordable: boolean;
};

export type ShopCardData = {
  /** Big title at the top of the card. */
  title: string;
  subtitle: string;
  pageLabel: string;
  /** Always SHOP_ITEMS_PER_PAGE entries; an unused slot is null. */
  tiles: Array<ShopCardTile | null>;
  empty: boolean;
  emptyTitle: string;
  emptyText: string;
  viewerName: string;
  balanceText: string;
  hint: string;
};

export function buildShopCardData(input: ShopCardInput): ShopCardData {
  const pages = shopPageCount(input.totalItems);
  const page = clampShopPage(input.page, input.totalItems);
  const symbol = input.currencySymbol;
  const wardrobe = input.mode === "wardrobe";

  const tiles: Array<ShopCardTile | null> = Array.from(
    { length: SHOP_ITEMS_PER_PAGE },
    (_, index) => {
      const item = input.items[index];
      if (!item) {
        return null;
      }
      const description = item.description?.trim();
      const owned = item.state !== "for_sale";
      return {
        number: index + 1,
        name: item.name.trim() || "Color",
        description: description ? description : null,
        priceText: wardrobe ? "Free to wear" : formatMoney(item.price, symbol),
        colorHex: colorToHex(item.color),
        color: item.color === 0 ? null : item.color,
        state: item.state,
        badge: item.state === "worn" ? "WEARING" : item.state === "owned" ? "OWNED" : null,
        affordable: wardrobe || owned || input.balance >= item.price,
      };
    },
  );

  const server = input.serverName.trim().toUpperCase();
  const empty = input.totalItems === 0;
  const label = wardrobe ? "YOUR COLORS" : "NAME COLORS";
  return {
    title: wardrobe ? "WARDROBE" : "COLOR SHOP",
    subtitle: server ? `${server} • ${label}` : label,
    pageLabel: `PAGE ${page + 1} / ${pages}`,
    tiles,
    empty,
    emptyTitle: wardrobe ? "Your wardrobe is empty" : "The shop is empty",
    emptyText: wardrobe
      ? "Buy a color with /shop and it shows up here"
      : "An admin can add colors with /shop-config add",
    viewerName: cardName(input.viewerName, null),
    balanceText: formatMoney(input.balance, symbol),
    hint: wardrobe
      ? empty
        ? "Nothing owned yet"
        : "Pick a color to put it on"
      : empty
        ? "Nothing for sale yet"
        : "Pick a color in the menu below",
  };
}
