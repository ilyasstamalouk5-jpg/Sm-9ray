import assert from "node:assert/strict";
import test from "node:test";
import { HELP_FIELD_LIMIT, fitFieldLines, helpExtraLines, type RegisteredCommandInfo } from "../src/commands/help-extra.js";

const registered = new Map<string, RegisteredCommandInfo>([
  ["shop", { description: "Buy name colors.", adminOnly: false }],
  ["newthing", { description: "Something added later.", adminOnly: false }],
  ["anothernew", { description: "Also new.", adminOnly: false }],
  ["secretadmin", { description: "Admin tool.", adminOnly: true }],
]);
const catalog = new Set(["shop"]);

test("registered commands missing from the catalog are listed, sorted by name", () => {
  assert.deepEqual(helpExtraLines(registered, catalog, false), [
    "`/anothernew`\nAlso new.",
    "`/newthing`\nSomething added later.",
  ]);
});

test("admin-only commands are listed only for administrators", () => {
  assert.equal(helpExtraLines(registered, catalog, false).some((line) => line.includes("secretadmin")), false);
  assert.ok(helpExtraLines(registered, catalog, true).some((line) => line.includes("secretadmin")));
});

test("nothing is listed when the catalog covers every command", () => {
  assert.deepEqual(helpExtraLines(registered, new Set(registered.keys()), true), []);
});

test("a field value never exceeds Discord's limit and only whole lines are kept", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `\`/command${index}\`\n${"d".repeat(50)}`);
  const value = fitFieldLines(lines);
  assert.ok(value.length <= HELP_FIELD_LIMIT);
  assert.ok(value.split("\n").length % 2 === 0, "no half-cut entries");
  assert.equal(fitFieldLines([]), "");
});
