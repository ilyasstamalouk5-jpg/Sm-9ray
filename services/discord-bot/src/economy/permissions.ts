import type { EconomyConfig } from "./economy-config.js";

/** The bot serves one server. Anything from another server is ignored. */
export function isTargetGuild(
  interactionGuildId: string | null | undefined,
  config: Pick<EconomyConfig, "guildId">,
): boolean {
  return Boolean(config.guildId) && interactionGuildId === config.guildId;
}

/**
 * Economy administration: Discord Administrators, or members holding the
 * configured ADMIN_ROLE_ID. Always checked on the server, never trusted from
 * the client.
 */
export function isEconomyAdmin(
  member: { isAdministrator: boolean; roleIds: readonly string[] },
  config: Pick<EconomyConfig, "adminRoleId">,
): boolean {
  if (member.isAdministrator) {
    return true;
  }
  return Boolean(config.adminRoleId) && member.roleIds.includes(config.adminRoleId as string);
}
