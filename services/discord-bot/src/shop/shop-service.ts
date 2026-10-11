import { randomUUID } from "node:crypto";
import type { EconomyConfig } from "../economy/economy-config.js";
import { formatDh } from "../economy/format.js";
import {
  SHOP_MAX_ITEMS,
  cleanShopDescription,
  cleanShopName,
  priceProblem,
  roleSaleProblem,
  type RoleInfo,
  type ShopItem,
} from "./shop-rules.js";
import type { RoleChangeResult, ShopRoleOperations } from "./shop-roles.js";
import type { ShopItemPatch, ShopStore } from "./shop-store.js";

type Money = Pick<EconomyConfig, "currencySymbol" | "currencyEmoji">;

export type ShopServiceDeps = {
  store: ShopStore;
  roles: ShopRoleOperations;
  money: Money;
  /** Roles that must never be sold (milestone roles, the admin role). */
  reservedRoleIds: () => string[];
  clock?: () => Date;
  newId?: () => string;
};

export type Failure = { ok: false; message: string };

export type BuyOutcome =
  | {
      ok: true;
      item: ShopItem;
      pricePaid: number;
      balance: number;
      /** False when the color was bought but could not be put on right now. */
      equipped: boolean;
      equipMessage?: string;
    }
  | (Failure & { reason: string; balance?: number });

export type EquipOutcome = { ok: true; item: ShopItem } | Failure;

function equipFailureMessage(result: Exclude<RoleChangeResult, { ok: true }>): string {
  switch (result.reason) {
    case "member_missing":
      return "I could not find you in the server.";
    case "denied":
      return "Discord would not let me change your roles. An admin needs to check that my role is above the color roles and that I have Manage Roles.";
    default:
      return "Discord did not accept the role change. Please try again in a moment.";
  }
}

export class ShopService {
  private readonly clock: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: ShopServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  private money(amount: number): string {
    return formatDh(amount, this.deps.money);
  }

  listItems(): Promise<ShopItem[]> {
    return this.deps.store.listItems();
  }

  getItem(id: string): Promise<ShopItem | null> {
    return this.deps.store.getItem(id);
  }

  ownerCounts(): Promise<Map<string, number>> {
    return this.deps.store.countOwners();
  }

  reservedRoleIds(): string[] {
    return this.deps.reservedRoleIds();
  }

  listOwned(userId: string): Promise<ShopItem[]> {
    return this.deps.store.listOwnedItems(userId);
  }

  // ------------------------------------------------------------------ admin

  async addItem(input: {
    adminId: string;
    role: RoleInfo;
    price: number;
    name?: string | null;
    description?: string | null;
  }): Promise<{ ok: true; item: ShopItem } | Failure> {
    const roleProblem = roleSaleProblem(input.role, this.deps.reservedRoleIds());
    if (roleProblem) {
      return { ok: false, message: roleProblem };
    }
    const price = priceProblem(input.price);
    if (price) {
      return { ok: false, message: price };
    }
    const name = cleanShopName(input.name?.trim() ? input.name : input.role.name);
    if (!name.ok) {
      return { ok: false, message: name.message };
    }
    const description = cleanShopDescription(input.description ?? "");
    if (!description.ok) {
      return { ok: false, message: description.message };
    }
    const result = await this.deps.store.addItem({
      id: this.newId(),
      roleId: input.role.id,
      name: name.name,
      description: description.description,
      price: input.price,
      color: input.role.color,
      createdBy: input.adminId,
      now: this.clock(),
    });
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === "role_taken"
            ? "That role is already in the shop. Use edit to change it."
            : `The shop is full (${SHOP_MAX_ITEMS} colors). Remove one first.`,
      };
    }
    return { ok: true, item: result.item };
  }

  async editItem(input: {
    role: RoleInfo;
    price?: number | null;
    name?: string | null;
    description?: string | null;
    position?: number | null;
  }): Promise<{ ok: true; item: ShopItem } | Failure> {
    const existing = await this.deps.store.getItemByRole(input.role.id);
    if (!existing) {
      return { ok: false, message: "That role is not in the shop." };
    }
    const patch: ShopItemPatch = { color: input.role.color };
    if (input.price !== undefined && input.price !== null) {
      const problem = priceProblem(input.price);
      if (problem) {
        return { ok: false, message: problem };
      }
      patch.price = input.price;
    }
    if (input.name !== undefined && input.name !== null) {
      const name = cleanShopName(input.name);
      if (!name.ok) {
        return { ok: false, message: name.message };
      }
      patch.name = name.name;
    }
    if (input.description !== undefined && input.description !== null) {
      const description = cleanShopDescription(input.description);
      if (!description.ok) {
        return { ok: false, message: description.message };
      }
      patch.description = description.description;
    }
    if (input.position !== undefined && input.position !== null) {
      if (!Number.isSafeInteger(input.position) || input.position < 1) {
        return { ok: false, message: "The position must be a whole number from 1 up." };
      }
    }
    const now = this.clock();
    const item = await this.deps.store.updateItem(existing.id, patch, now);
    if (!item) {
      return { ok: false, message: "That role is no longer in the shop." };
    }
    if (input.position !== undefined && input.position !== null) {
      const others = (await this.deps.store.listItems())
        .filter((entry) => entry.id !== item.id)
        .map((entry) => entry.id);
      others.splice(Math.min(input.position - 1, others.length), 0, item.id);
      await this.deps.store.reorderItems(others, now);
    }
    return { ok: true, item: (await this.deps.store.getItem(item.id)) ?? item };
  }

  async removeItem(
    roleId: string,
  ): Promise<{ ok: true; item: ShopItem; owners: number } | Failure> {
    const existing = await this.deps.store.getItemByRole(roleId);
    if (!existing) {
      return { ok: false, message: "That role is not in the shop." };
    }
    const result = await this.deps.store.archiveItem(existing.id, this.clock());
    if (!result) {
      return { ok: false, message: "That role is no longer in the shop." };
    }
    return { ok: true, item: result.item, owners: result.owners };
  }

  // ----------------------------------------------------------------- member

  /**
   * Buys a color: checks the bot can hand the role out, charges the wallet
   * atomically, then puts the color on the member. Nobody is charged for a
   * role the bot cannot assign. If putting the color on fails AFTER payment,
   * the member still owns it and can equip it again later.
   */
  async buy(input: {
    userId: string;
    itemId: string;
    expectedPrice: number;
  }): Promise<BuyOutcome> {
    const item = await this.deps.store.getItem(input.itemId);
    if (!item || item.archived) {
      return { ok: false, reason: "unavailable", message: "That color is no longer for sale." };
    }

    const check = await this.deps.roles.checkAssignable(item.roleId);
    if (!check.ok) {
      return {
        ok: false,
        reason: "role_unavailable",
        message:
          "This color cannot be given out right now, so you were not charged. Please tell an admin.",
      };
    }

    const result = await this.deps.store.purchaseItem({
      userId: input.userId,
      itemId: input.itemId,
      expectedPrice: input.expectedPrice,
      now: this.clock(),
    });
    if (!result.ok) {
      switch (result.reason) {
        case "insufficient_funds":
          return {
            ok: false,
            reason: result.reason,
            balance: result.balance,
            message: `You need ${this.money(item.price)} but only have ${this.money(result.balance)}.`,
          };
        case "already_owned":
          return { ok: false, reason: result.reason, balance: result.balance, message: "You already own this color." };
        case "price_changed":
          return {
            ok: false,
            reason: result.reason,
            balance: result.balance,
            message: `The price just changed to ${this.money(result.currentPrice ?? item.price)}. Open the shop again to see it. You were not charged.`,
          };
        default:
          return { ok: false, reason: result.reason, balance: result.balance, message: "That color is no longer for sale." };
      }
    }

    const equip = await this.equipRole(input.userId, result.item);
    return {
      ok: true,
      item: result.item,
      pricePaid: result.pricePaid,
      balance: result.balance,
      equipped: equip.ok,
      ...(equip.ok ? {} : { equipMessage: equipFailureMessage(equip) }),
    };
  }

  private async equipRole(userId: string, item: ShopItem): Promise<RoleChangeResult> {
    const all = await this.deps.store.listAllShopRoleIds();
    return this.deps.roles.equip(
      userId,
      item.roleId,
      all.filter((roleId) => roleId !== item.roleId),
    );
  }

  /** Puts an owned color on (free). Replaces any other shop color. */
  async equip(userId: string, itemId: string): Promise<EquipOutcome> {
    const item = await this.deps.store.getItem(itemId);
    if (!item) {
      return { ok: false, message: "That color does not exist." };
    }
    const owned = await this.deps.store.listOwnedItems(userId);
    if (!owned.some((entry) => entry.id === item.id)) {
      return { ok: false, message: "You do not own that color yet." };
    }
    const check = await this.deps.roles.checkAssignable(item.roleId);
    if (!check.ok) {
      return { ok: false, message: "I cannot give out that color right now. Please tell an admin." };
    }
    const result = await this.equipRole(userId, item);
    return result.ok ? { ok: true, item } : { ok: false, message: equipFailureMessage(result) };
  }

  /** Takes the worn shop color off. The member keeps owning it. */
  async unequip(userId: string): Promise<{ ok: true } | Failure> {
    const all = await this.deps.store.listAllShopRoleIds();
    const result = await this.deps.roles.unequip(userId, all);
    return result.ok ? { ok: true } : { ok: false, message: equipFailureMessage(result) };
  }

  /** The shop color a member wears now (null if none or unknown). */
  async wornItem(userId: string): Promise<ShopItem | null> {
    const owned = await this.deps.store.listOwnedItems(userId);
    if (owned.length === 0) {
      return null;
    }
    const worn = await this.deps.roles.worn(
      userId,
      owned.map((item) => item.roleId),
    );
    if (!worn) {
      return null;
    }
    return owned.find((item) => worn.includes(item.roleId)) ?? null;
  }
}
