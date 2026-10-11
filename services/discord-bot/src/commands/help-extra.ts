// Safety net for /help: any registered command that has no entry in the help
// catalog is still listed, using the description it was registered with. Pure
// functions, so they are tested without Discord.

export type RegisteredCommandInfo = {
  description: string;
  /** True when Discord hides the command from non-administrators. */
  adminOnly: boolean;
};

/** Discord allows at most 1024 characters in one embed field. */
export const HELP_FIELD_LIMIT = 1024;

/** The lines for registered commands that the catalog does not mention. */
export function helpExtraLines(
  registered: ReadonlyMap<string, RegisteredCommandInfo>,
  catalogNames: ReadonlySet<string>,
  showAdmin: boolean,
): string[] {
  return [...registered]
    .filter(([name, info]) => !catalogNames.has(name) && (!info.adminOnly || showAdmin))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, info]) => `\`/${name}\`\n${info.description}`);
}

/** Joins lines into one field value, dropping whole lines that would not fit. */
export function fitFieldLines(lines: readonly string[], limit = HELP_FIELD_LIMIT): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const added = line.length + (kept.length > 0 ? 1 : 0);
    if (length + added > limit) {
      break;
    }
    kept.push(line);
    length += added;
  }
  return kept.join("\n");
}
