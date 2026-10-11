CREATE TABLE "discord_bot_wallets" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_wallets_balance_nonnegative" CHECK ("discord_bot_wallets"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discord_bot_wallet_transactions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discord_bot_wallet_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"discord_user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_wallet_transactions_amount_nonzero" CHECK ("discord_bot_wallet_transactions"."amount" <> 0),
	CONSTRAINT "discord_bot_wallet_transactions_balance_after_nonnegative" CHECK ("discord_bot_wallet_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discord_bot_economy_claims" (
	"discord_user_id" text NOT NULL,
	"claim_type" text NOT NULL,
	"last_claimed_at" timestamp with time zone NOT NULL,
	"claim_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "discord_bot_economy_claims_pk" PRIMARY KEY("discord_user_id","claim_type"),
	CONSTRAINT "discord_bot_economy_claims_type_valid" CHECK ("discord_bot_economy_claims"."claim_type" IN ('work', 'daily'))
);
--> statement-breakpoint
CREATE TABLE "discord_bot_voice_reward_checkpoints" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"credited_seconds" bigint DEFAULT 0 NOT NULL,
	"total_paid" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_voice_reward_checkpoints_credited_nonnegative" CHECK ("discord_bot_voice_reward_checkpoints"."credited_seconds" >= 0),
	CONSTRAINT "discord_bot_voice_reward_checkpoints_paid_nonnegative" CHECK ("discord_bot_voice_reward_checkpoints"."total_paid" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discord_bot_casino_games" (
	"id" text PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"game_type" text NOT NULL,
	"wager" bigint NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"payout" bigint,
	"channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "discord_bot_casino_games_type_valid" CHECK ("discord_bot_casino_games"."game_type" IN ('mines', 'appletower', 'blackjack')),
	CONSTRAINT "discord_bot_casino_games_status_valid" CHECK ("discord_bot_casino_games"."status" IN ('active', 'settled')),
	CONSTRAINT "discord_bot_casino_games_wager_positive" CHECK ("discord_bot_casino_games"."wager" > 0),
	CONSTRAINT "discord_bot_casino_games_payout_nonnegative" CHECK ("discord_bot_casino_games"."payout" IS NULL OR "discord_bot_casino_games"."payout" >= 0)
);
--> statement-breakpoint
CREATE TABLE "discord_bot_economy_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "discord_bot_wallets_balance_idx" ON "discord_bot_wallets" USING btree ("balance");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_bot_wallet_transactions_idempotency_key_idx" ON "discord_bot_wallet_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "discord_bot_wallet_transactions_user_idx" ON "discord_bot_wallet_transactions" USING btree ("discord_user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_bot_casino_games_one_active_per_user_idx" ON "discord_bot_casino_games" USING btree ("discord_user_id") WHERE "discord_bot_casino_games"."status" = 'active';--> statement-breakpoint
CREATE INDEX "discord_bot_casino_games_status_expires_idx" ON "discord_bot_casino_games" USING btree ("status","expires_at");--> statement-breakpoint
-- Baseline for voice rewards: time members have ALREADY accumulated before this
-- release is not paid retroactively. Only voice time earned from now on counts.
-- (To pay existing time too, set credited_seconds to 0 for the members you want.)
INSERT INTO "discord_bot_voice_reward_checkpoints" ("discord_user_id", "credited_seconds")
SELECT "discord_user_id", "total_voice_time_seconds" FROM "discord_bot_users"
ON CONFLICT ("discord_user_id") DO NOTHING;
