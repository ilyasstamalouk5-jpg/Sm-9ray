CREATE TABLE "discord_bot_shop_items" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" bigint NOT NULL,
	"color" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_shop_items_price_positive" CHECK ("discord_bot_shop_items"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "discord_bot_shop_purchases" (
	"discord_user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"price_paid" bigint NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_shop_purchases_pk" PRIMARY KEY("discord_user_id","item_id"),
	CONSTRAINT "discord_bot_shop_purchases_price_nonnegative" CHECK ("discord_bot_shop_purchases"."price_paid" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discord_bot_shop_items_active_role_idx" ON "discord_bot_shop_items" USING btree ("role_id") WHERE "discord_bot_shop_items"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "discord_bot_shop_items_sort_idx" ON "discord_bot_shop_items" USING btree ("sort_order","price");--> statement-breakpoint
CREATE INDEX "discord_bot_shop_purchases_item_idx" ON "discord_bot_shop_purchases" USING btree ("item_id");
