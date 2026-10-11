import { db } from "@workspace/db";
import {
  discordBotShopItems,
  discordBotShopPurchases,
  type DiscordBotShopItem,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { DrizzleEconomyStore, isUniqueViolation } from "../economy/drizzle-store.js";
import { SHOP_MAX_ITEMS, type ShopItem } from "./shop-rules.js";
import type {
  AddItemResult,
  NewShopItem,
  PurchaseResult,
  ShopItemPatch,
  ShopStore,
} from "./shop-store.js";

function toItem(row: DiscordBotShopItem): ShopItem {
  return {
    id: row.id,
    roleId: row.roleId,
    name: row.name,
    description: row.description,
    price: row.price,
    color: row.color,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
  };
}

/**
 * The wallet store plus the color shop. It extends the economy store so a
 * purchase can use the same wallet lock and ledger as every other payment:
 * the charge and the ownership record are saved in ONE transaction.
 */
export class DrizzleShopStore extends DrizzleEconomyStore implements ShopStore {
  async listItems(): Promise<ShopItem[]> {
    const rows = await db
      .select()
      .from(discordBotShopItems)
      .where(isNull(discordBotShopItems.archivedAt))
      .orderBy(
        asc(discordBotShopItems.sortOrder),
        asc(discordBotShopItems.price),
        asc(discordBotShopItems.name),
      );
    return rows.map(toItem);
  }

  async listAllShopRoleIds(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ roleId: discordBotShopItems.roleId })
      .from(discordBotShopItems);
    return rows.map((row) => row.roleId);
  }

  async getItem(id: string): Promise<ShopItem | null> {
    const [row] = await db
      .select()
      .from(discordBotShopItems)
      .where(eq(discordBotShopItems.id, id))
      .limit(1);
    return row ? toItem(row) : null;
  }

  async getItemByRole(roleId: string): Promise<ShopItem | null> {
    const [row] = await db
      .select()
      .from(discordBotShopItems)
      .where(
        and(
          eq(discordBotShopItems.roleId, roleId),
          isNull(discordBotShopItems.archivedAt),
        ),
      )
      .limit(1);
    return row ? toItem(row) : null;
  }

  async addItem(input: NewShopItem): Promise<AddItemResult> {
    try {
      return await db.transaction(async (tx) => {
        const [stats] = await tx
          .select({
            active: sql<number>`count(*)::int`,
            top: sql<number>`coalesce(max(${discordBotShopItems.sortOrder}), 0)::int`,
          })
          .from(discordBotShopItems)
          .where(isNull(discordBotShopItems.archivedAt));
        if ((stats?.active ?? 0) >= SHOP_MAX_ITEMS) {
          return { ok: false, reason: "limit_reached" } as const;
        }
        const [row] = await tx
          .insert(discordBotShopItems)
          .values({
            id: input.id,
            roleId: input.roleId,
            name: input.name,
            description: input.description,
            price: input.price,
            color: input.color,
            sortOrder: (stats?.top ?? 0) + 10,
            createdBy: input.createdBy,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!row) {
          throw new Error("Shop item was not returned after insert.");
        }
        return { ok: true, item: toItem(row) } as const;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: "role_taken" };
      }
      throw error;
    }
  }

  async updateItem(
    id: string,
    patch: ShopItemPatch,
    now: Date,
  ): Promise<ShopItem | null> {
    const [row] = await db
      .update(discordBotShopItems)
      .set({ ...patch, updatedAt: now })
      .where(
        and(eq(discordBotShopItems.id, id), isNull(discordBotShopItems.archivedAt)),
      )
      .returning();
    return row ? toItem(row) : null;
  }

  async archiveItem(
    id: string,
    now: Date,
  ): Promise<{ item: ShopItem; owners: number } | null> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(discordBotShopItems)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(eq(discordBotShopItems.id, id), isNull(discordBotShopItems.archivedAt)),
        )
        .returning();
      if (!row) {
        return null;
      }
      const [owners] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(discordBotShopPurchases)
        .where(eq(discordBotShopPurchases.itemId, id));
      return { item: toItem(row), owners: owners?.total ?? 0 };
    });
  }

  async countOwners(): Promise<Map<string, number>> {
    const rows = await db
      .select({
        itemId: discordBotShopPurchases.itemId,
        total: sql<number>`count(*)::int`,
      })
      .from(discordBotShopPurchases)
      .groupBy(discordBotShopPurchases.itemId);
    return new Map(rows.map((row) => [row.itemId, row.total]));
  }

  async reorderItems(orderedIds: readonly string[], now: Date): Promise<void> {
    await db.transaction(async (tx) => {
      for (const [index, id] of orderedIds.entries()) {
        await tx
          .update(discordBotShopItems)
          .set({ sortOrder: (index + 1) * 10, updatedAt: now })
          .where(
            and(eq(discordBotShopItems.id, id), isNull(discordBotShopItems.archivedAt)),
          );
      }
    });
  }

  async listOwnedItems(userId: string): Promise<ShopItem[]> {
    const rows = await db
      .select({ item: discordBotShopItems })
      .from(discordBotShopPurchases)
      .innerJoin(
        discordBotShopItems,
        eq(discordBotShopPurchases.itemId, discordBotShopItems.id),
      )
      .where(eq(discordBotShopPurchases.discordUserId, userId))
      .orderBy(
        asc(discordBotShopItems.sortOrder),
        asc(discordBotShopItems.price),
        asc(discordBotShopItems.name),
      );
    return rows.map((row) => toItem(row.item));
  }

  async purchaseItem(input: {
    userId: string;
    itemId: string;
    expectedPrice: number;
    now: Date;
  }): Promise<PurchaseResult> {
    return db.transaction(async (tx) => {
      // Locks this member's wallet, so two clicks at once are handled one by one.
      const balance = await this.lockWallet(tx, input.userId);

      const [row] = await tx
        .select()
        .from(discordBotShopItems)
        .where(eq(discordBotShopItems.id, input.itemId))
        .limit(1);
      if (!row) {
        return { ok: false, reason: "not_found", balance } as const;
      }
      if (row.archivedAt) {
        return { ok: false, reason: "unavailable", balance } as const;
      }

      const [owned] = await tx
        .select({ itemId: discordBotShopPurchases.itemId })
        .from(discordBotShopPurchases)
        .where(
          and(
            eq(discordBotShopPurchases.discordUserId, input.userId),
            eq(discordBotShopPurchases.itemId, row.id),
          ),
        )
        .limit(1);
      if (owned) {
        return { ok: false, reason: "already_owned", balance } as const;
      }

      if (row.price !== input.expectedPrice) {
        return {
          ok: false,
          reason: "price_changed",
          balance,
          currentPrice: row.price,
        } as const;
      }

      const paid = await this.applyDelta(
        tx,
        input.userId,
        balance,
        -row.price,
        "shop_purchase",
        `shop:${input.userId}:${row.id}`,
        `Color role: ${row.name}`,
      );
      if (paid.status === "insufficient") {
        return { ok: false, reason: "insufficient_funds", balance: paid.balance } as const;
      }
      if (paid.status === "duplicate") {
        return { ok: false, reason: "already_owned", balance: paid.balance } as const;
      }

      await tx.insert(discordBotShopPurchases).values({
        discordUserId: input.userId,
        itemId: row.id,
        pricePaid: row.price,
        purchasedAt: input.now,
      });
      return {
        ok: true,
        item: toItem(row),
        pricePaid: row.price,
        balance: paid.balance,
      } as const;
    });
  }
}
