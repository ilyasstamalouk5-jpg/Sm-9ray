import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One wallet per Discord user. The balance is an integer number of Dirhams (DH)
// and can never be negative.
export const discordBotWallets = pgTable(
  "discord_bot_wallets",
  {
    discordUserId: text("discord_user_id").primaryKey(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "discord_bot_wallets_balance_nonnegative",
      sql`${table.balance} >= 0`,
    ),
    index("discord_bot_wallets_balance_idx").on(table.balance),
  ],
);

// Append-only ledger. Every balance change writes exactly one row here, and
// the unique idempotency key makes it impossible to apply the same change twice.
export const discordBotWalletTransactions = pgTable(
  "discord_bot_wallet_transactions",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    discordUserId: text("discord_user_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    kind: text("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("discord_bot_wallet_transactions_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
    index("discord_bot_wallet_transactions_user_idx").on(
      table.discordUserId,
      table.id,
    ),
    check(
      "discord_bot_wallet_transactions_amount_nonzero",
      sql`${table.amount} <> 0`,
    ),
    check(
      "discord_bot_wallet_transactions_balance_after_nonnegative",
      sql`${table.balanceAfter} >= 0`,
    ),
  ],
);

export type DiscordBotWallet = typeof discordBotWallets.$inferSelect;
export type DiscordBotWalletTransaction =
  typeof discordBotWalletTransactions.$inferSelect;
