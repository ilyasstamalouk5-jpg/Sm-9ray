CREATE TABLE "discord_bot_milestone_settings" (
	"milestone_id" text PRIMARY KEY NOT NULL,
	"required_voice_time_seconds" integer,
	"role_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
