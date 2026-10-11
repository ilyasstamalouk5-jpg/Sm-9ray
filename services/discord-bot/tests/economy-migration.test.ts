import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../lib/db/migrations",
);
const read = (name: string) => readFileSync(path.join(migrations, name), "utf8");

test("the economy migration is forward-only and never destroys existing data", () => {
  const sql = read("0003_add_economy.sql").replace(/--.*$/gm, "");
  for (const forbidden of [/\bDROP\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bUPDATE\b/i, /ALTER\s+TABLE[^;]*\bDROP\b/i, /\bRENAME\b/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  // It only creates new tables/indexes, plus one insert that seeds checkpoints.
  const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) {
    assert.match(statement, /^(CREATE (UNIQUE )?(TABLE|INDEX)|INSERT INTO "discord_bot_voice_reward_checkpoints")/);
  }
  // It does not touch the existing voice tables.
  for (const existing of ["discord_bot_users", "discord_bot_voice_sessions", "discord_bot_user_milestones", "discord_bot_milestone_settings"]) {
    assert.doesNotMatch(sql.replace(/FROM "discord_bot_users"/, ""), new RegExp(`(CREATE|ALTER) TABLE "${existing}"`));
  }
});

test("existing members' voice time is baselined so they are not paid retroactively", () => {
  const sql = read("0003_add_economy.sql");
  assert.match(sql, /SELECT "discord_user_id", "total_voice_time_seconds" FROM "discord_bot_users"/);
  assert.match(sql, /ON CONFLICT \("discord_user_id"\) DO NOTHING/);
});

test("the journal lists every migration file in order and the new snapshot chains on", () => {
  const journal = JSON.parse(read("meta/_journal.json")) as { entries: Array<{ idx: number; tag: string }> };
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).map((f) => f.replace(".sql", "")).sort();
  assert.deepEqual(journal.entries.map((e) => e.tag), files);
  assert.deepEqual(journal.entries.map((e) => e.idx), files.map((_, i) => i));
  const prev = JSON.parse(read("meta/0002_snapshot.json")) as { id: string };
  const next = JSON.parse(read("meta/0003_snapshot.json")) as { prevId: string; tables: Record<string, unknown> };
  assert.equal(next.prevId, prev.id);
  for (const table of ["discord_bot_users", "discord_bot_voice_sessions", "discord_bot_user_milestones", "discord_bot_milestone_settings", "discord_bot_wallets", "discord_bot_wallet_transactions", "discord_bot_economy_claims", "discord_bot_voice_reward_checkpoints", "discord_bot_casino_games", "discord_bot_economy_settings"]) {
    assert.ok(`public.${table}` in next.tables, table);
  }
});

test("earlier migrations were not modified (their files still start as before)", () => {
  assert.match(read("0000_init_discord_bot.sql"), /^CREATE TABLE "discord_bot_users"/);
  assert.match(read("0001_add_voice_session_heartbeat.sql"), /^ALTER TABLE "discord_bot_voice_sessions" ADD COLUMN "last_seen_at"/);
  assert.match(read("0002_add_milestone_settings.sql"), /^CREATE TABLE "discord_bot_milestone_settings"/);
});
