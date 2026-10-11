import { SHOP_MAX_ITEMS, type ShopItem } from "../../src/shop/shop-rules.js";
import type {
  AddItemResult,
  NewShopItem,
  PurchaseResult,
  ShopItemPatch,
  ShopStore,
} from "../../src/shop/shop-store.js";
import { MemoryEconomyStore } from "./memory-economy-store.js";
import type {
  RoleChangeResult,
  RoleCheck,
  ShopRoleOperations,
} from "../../src/shop/shop-roles.js";

/**
 * In-memory shop with the same rules as the PostgreSQL one: one active item
 * per role, permanent ownership, and a charge that happens together with the
 * ownership record. Each method runs without awaiting, so it is atomic.
 */
export class MemoryShopStore extends MemoryEconomyStore implements ShopStore {
  readonly items = new Map<string, ShopItem>();
  readonly owned = new Map<string, Map<string, number>>(); // userId -> itemId -> price paid

  async listItems(): Promise<ShopItem[]> {
    return [...this.items.values()]
      .filter((item) => !item.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.price - b.price || a.name.localeCompare(b.name));
  }

  async listAllShopRoleIds(): Promise<string[]> {
    return [...new Set([...this.items.values()].map((item) => item.roleId))];
  }

  async getItem(id: string): Promise<ShopItem | null> {
    return this.items.get(id) ?? null;
  }

  async getItemByRole(roleId: string): Promise<ShopItem | null> {
    return [...this.items.values()].find((item) => item.roleId === roleId && !item.archived) ?? null;
  }

  async addItem(input: NewShopItem): Promise<AddItemResult> {
    const active = [...this.items.values()].filter((item) => !item.archived);
    if (active.length >= SHOP_MAX_ITEMS) {
      return { ok: false, reason: "limit_reached" };
    }
    if (active.some((item) => item.roleId === input.roleId)) {
      return { ok: false, reason: "role_taken" };
    }
    const item: ShopItem = {
      id: input.id,
      roleId: input.roleId,
      name: input.name,
      description: input.description,
      price: input.price,
      color: input.color,
      sortOrder: active.reduce((top, entry) => Math.max(top, entry.sortOrder), 0) + 10,
      archived: false,
    };
    this.items.set(item.id, item);
    return { ok: true, item };
  }

  async updateItem(id: string, patch: ShopItemPatch): Promise<ShopItem | null> {
    const item = this.items.get(id);
    if (!item || item.archived) {
      return null;
    }
    const next = { ...item, ...patch } as ShopItem;
    this.items.set(id, next);
    return next;
  }

  async archiveItem(id: string): Promise<{ item: ShopItem; owners: number } | null> {
    const item = this.items.get(id);
    if (!item || item.archived) {
      return null;
    }
    const next = { ...item, archived: true };
    this.items.set(id, next);
    const owners = [...this.owned.values()].filter((entries) => entries.has(id)).length;
    return { item: next, owners };
  }

  async countOwners(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const entries of this.owned.values()) {
      for (const id of entries.keys()) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }

  async reorderItems(orderedIds: readonly string[]): Promise<void> {
    orderedIds.forEach((id, index) => {
      const item = this.items.get(id);
      if (item && !item.archived) {
        this.items.set(id, { ...item, sortOrder: (index + 1) * 10 });
      }
    });
  }

  async listOwnedItems(userId: string): Promise<ShopItem[]> {
    const entries = this.owned.get(userId);
    if (!entries) {
      return [];
    }
    return [...entries.keys()]
      .map((id) => this.items.get(id))
      .filter((item): item is ShopItem => Boolean(item))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.price - b.price);
  }

  async purchaseItem(input: {
    userId: string;
    itemId: string;
    expectedPrice: number;
  }): Promise<PurchaseResult> {
    const balance = this.wallet(input.userId);
    const item = this.items.get(input.itemId);
    if (!item) {
      return { ok: false, reason: "not_found", balance };
    }
    if (item.archived) {
      return { ok: false, reason: "unavailable", balance };
    }
    if (this.owned.get(input.userId)?.has(item.id)) {
      return { ok: false, reason: "already_owned", balance };
    }
    if (item.price !== input.expectedPrice) {
      return { ok: false, reason: "price_changed", balance, currentPrice: item.price };
    }
    const status = this.apply(input.userId, -item.price, "shop_purchase", `shop:${input.userId}:${item.id}`);
    if (status === "insufficient") {
      return { ok: false, reason: "insufficient_funds", balance };
    }
    if (status === "duplicate") {
      return { ok: false, reason: "already_owned", balance };
    }
    const entries = this.owned.get(input.userId) ?? new Map<string, number>();
    entries.set(item.id, item.price);
    this.owned.set(input.userId, entries);
    return { ok: true, item, pricePaid: item.price, balance: this.wallet(input.userId) };
  }
}

/** A fake Discord: tracks which roles each member wears. */
export class FakeShopRoles implements ShopRoleOperations {
  readonly worn_ = new Map<string, Set<string>>();
  /** Roles the fake bot is able to assign. Others fail the pre-check. */
  assignable = new Set<string>();
  /** Set to make every role change fail after payment. */
  failChanges: "denied" | "failed" | null = null;
  calls: string[] = [];

  async checkAssignable(roleId: string): Promise<RoleCheck> {
    return this.assignable.has(roleId) ? { ok: true } : { ok: false, reason: "cannot_assign" };
  }

  async equip(userId: string, roleId: string, removeRoleIds: readonly string[]): Promise<RoleChangeResult> {
    this.calls.push(`equip:${userId}:${roleId}`);
    if (this.failChanges) {
      return { ok: false, reason: this.failChanges };
    }
    const set = this.worn_.get(userId) ?? new Set<string>();
    set.add(roleId);
    for (const id of removeRoleIds) {
      if (id !== roleId) {
        set.delete(id);
      }
    }
    this.worn_.set(userId, set);
    return { ok: true };
  }

  async unequip(userId: string, roleIds: readonly string[]): Promise<RoleChangeResult> {
    if (this.failChanges) {
      return { ok: false, reason: this.failChanges };
    }
    const set = this.worn_.get(userId) ?? new Set<string>();
    for (const id of roleIds) {
      set.delete(id);
    }
    return { ok: true };
  }

  async worn(userId: string, candidateRoleIds: readonly string[]): Promise<string[] | null> {
    const set = this.worn_.get(userId) ?? new Set<string>();
    return candidateRoleIds.filter((id) => set.has(id));
  }
}
