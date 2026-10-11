// The shop talks to storage only through this interface. The real
// implementation (drizzle-shop-store.ts) uses PostgreSQL transactions; tests
// use an in-memory copy with the same rules.

import type { ShopItem } from "./shop-rules.js";

export type NewShopItem = {
  id: string;
  roleId: string;
  name: string;
  description: string | null;
  price: number;
  color: number;
  createdBy: string;
  now: Date;
};

export type ShopItemPatch = {
  name?: string;
  description?: string | null;
  price?: number;
  color?: number;
  sortOrder?: number;
};

export type AddItemResult =
  | { ok: true; item: ShopItem }
  | { ok: false; reason: "role_taken" | "limit_reached" };

export type PurchaseResult =
  | { ok: true; item: ShopItem; pricePaid: number; balance: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "unavailable"
        | "already_owned"
        | "insufficient_funds"
        | "price_changed";
      balance: number;
      /** Set when the reason is "price_changed". */
      currentPrice?: number;
    };

export interface ShopStore {
  /** Items on sale, in display order (sort order, then price, then name). */
  listItems(): Promise<ShopItem[]>;
  /** Every role ID that is or was a shop role (used to swap colors). */
  listAllShopRoleIds(): Promise<string[]>;
  /** An item by ID, whether or not it is still on sale. */
  getItem(id: string): Promise<ShopItem | null>;
  /** The item currently on sale for this role, if any. */
  getItemByRole(roleId: string): Promise<ShopItem | null>;
  addItem(input: NewShopItem): Promise<AddItemResult>;
  /** Changes an item that is on sale. Null when it does not exist or was removed. */
  updateItem(id: string, patch: ShopItemPatch, now: Date): Promise<ShopItem | null>;
  /** Takes an item off sale. Owners keep it. Null when it was not on sale. */
  archiveItem(id: string, now: Date): Promise<{ item: ShopItem; owners: number } | null>;
  /** How many members own each item (by item ID). Items nobody owns are left out. */
  countOwners(): Promise<Map<string, number>>;
  /** Saves a new display order: the first ID gets the first place, and so on. */
  reorderItems(orderedIds: readonly string[], now: Date): Promise<void>;
  /** Everything a member owns, including items no longer on sale. */
  listOwnedItems(userId: string): Promise<ShopItem[]>;
  /**
   * Charges the wallet and records the purchase in one atomic step. Fails
   * with "price_changed" when the price is no longer `expectedPrice`.
   */
  purchaseItem(input: {
    userId: string;
    itemId: string;
    expectedPrice: number;
    now: Date;
  }): Promise<PurchaseResult>;
}
