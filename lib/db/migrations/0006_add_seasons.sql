CREATE TABLE "discord_bot_seasons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "discord_bot_seasons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_by" text,
	"members_reset" integer DEFAULT 0 NOT NULL,
	"milestone_records_cleared" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "discord_bot_seasons_counts_nonnegative" CHECK ("discord_bot_seasons"."members_reset" >= 0 AND "discord_bot_seasons"."milestone_records_cleared" >= 0)
);
