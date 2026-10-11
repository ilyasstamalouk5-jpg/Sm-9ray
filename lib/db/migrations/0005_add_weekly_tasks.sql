CREATE TABLE "discord_bot_weekly_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"goal_seconds" bigint NOT NULL,
	"reward" bigint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"channel_id" text,
	"message_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_bot_weekly_tasks_goal_positive" CHECK ("discord_bot_weekly_tasks"."goal_seconds" > 0),
	CONSTRAINT "discord_bot_weekly_tasks_reward_positive" CHECK ("discord_bot_weekly_tasks"."reward" > 0),
	CONSTRAINT "discord_bot_weekly_tasks_window_valid" CHECK ("discord_bot_weekly_tasks"."ends_at" > "discord_bot_weekly_tasks"."starts_at"),
	CONSTRAINT "discord_bot_weekly_tasks_status_valid" CHECK ("discord_bot_weekly_tasks"."status" IN ('active', 'ended'))
);
--> statement-breakpoint
CREATE INDEX "discord_bot_weekly_tasks_status_idx" ON "discord_bot_weekly_tasks" USING btree ("status","ends_at");
