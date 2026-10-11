import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Color roles that admins put on sale. One row per role. A row is never deleted:
// "removing" an item sets archived_at, so members who already bought it keep it.
export const discordBotShopItems = pgTable(
  "discord_bot_shop_items",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Price in whole Dirhams (DH).
    price: bigint("price", { mode: "number" }).notNull(),
    // Copy of the role's color (0xRRGGBB) taken when the admin saves the item.
    // The shop card reads the live color from Discord and uses this as a fallback.
    color: integer("color").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // A role can be on sale only once at a time, but can be re-added after removal.
    uniqueIndex("discord_bot_shop_items_active_role_idx")
      .on(table.roleId)
      .where(sql`${table.archivedAt} IS NULL`),
    index("discord_bot_shop_items_sort_idx").on(table.sortOrder, table.price),
    check("discord_bot_shop_items_price_positive", sql`${table.price} > 0`),
  ],
);

// What each member owns. Buying is permanent: the member can switch between
// owned colors for free, and keeps them even if the item is removed from sale.
export const discordBotShopPurchases = pgTable(
  "discord_bot_shop_purchases",
  {
    discordUserId: text("discord_user_id").notNull(),
    itemId: text("item_id").notNull(),
    pricePaid: bigint("price_paid", { mode: "number" }).notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "discord_bot_shop_purchases_pk",
      columns: [table.discordUserId, table.itemId],
    }),
    index("discord_bot_shop_purchases_item_idx").on(table.itemId),
    check(
      "discord_bot_shop_purchases_price_nonnegative",
      sql`${table.pricePaid} >= 0`,
    ),
  ],
);

export type DiscordBotShopItem = typeof discordBotShopItems.$inferSelect;
export type DiscordBotShopPurchase = typeof discordBotShopPurchases.$inferSelect;
