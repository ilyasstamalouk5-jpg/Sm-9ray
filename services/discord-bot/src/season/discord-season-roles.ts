import type { Client, Guild } from "discord.js";
import { logger } from "../config/logger.js";
import type {
  RoleStripResult,
  SeasonRoleOperations,
} from "./season-service.js";

/** Removes study roles from every member who holds them. */
export class DiscordSeasonRoleOperations implements SeasonRoleOperations {
  constructor(
    private readonly client: Client,
    private readonly guildId: string | undefined,
  ) {}

  async stripRoles(roleIds: readonly string[]): Promise<RoleStripResult> {
    const result: RoleStripResult = { removed: 0, failed: 0, missingRoleIds: [] };
    if (roleIds.length === 0) {
      return result;
    }
    const guild = await this.resolveGuild();
    if (!guild) {
      throw new Error("The target Discord server is not available.");
    }

    // One full member fetch fills every role's member list.
    await guild.members.fetch();

    for (const roleId of roleIds) {
      const role =
        guild.roles.cache.get(roleId) ??
        (await guild.roles.fetch(roleId).catch(() => null));
      if (!role) {
        result.missingRoleIds.push(roleId);
        continue;
      }
      for (const member of [...role.members.values()]) {
        try {
          await member.roles.remove(role, "Season reset");
          result.removed += 1;
        } catch (error) {
          result.failed += 1;
          logger.warn(
            { err: error, roleId, discordUserId: member.id },
            "Season reset: could not remove a study role from a member.",
          );
        }
      }
    }
    return result;
  }

  private async resolveGuild(): Promise<Guild | null> {
    if (this.guildId) {
      return (
        this.client.guilds.cache.get(this.guildId) ??
        (await this.client.guilds.fetch(this.guildId).catch(() => null))
      );
    }
    return this.client.guilds.cache.first() ?? null;
  }
}
