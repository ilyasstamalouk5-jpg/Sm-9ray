import type { Client, Guild, GuildMember } from "discord.js";
import { logger } from "../config/logger.js";
import { elevatedPermissionsOf } from "./shop-rules.js";
import type {
  RoleChangeResult,
  RoleCheck,
  ShopRoleOperations,
} from "./shop-roles.js";

function failureCode(error: unknown): { code?: unknown; status?: unknown } {
  if (!error || typeof error !== "object") {
    return {};
  }
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  return { code: candidate.code, status: candidate.status ?? candidate.statusCode };
}

function classify(error: unknown): "member_missing" | "denied" | "failed" {
  const { code, status } = failureCode(error);
  if (code === 10007 || code === "10007" || code === 10013) {
    return "member_missing";
  }
  if (code === 50013 || code === "50013" || code === 50001 || code === "50001" || status === 403) {
    return "denied";
  }
  return "failed";
}

/** Gives and takes shop color roles in the one target server. */
export class DiscordShopRoleOperations implements ShopRoleOperations {
  constructor(
    private readonly client: Client,
    private readonly guildId: string,
  ) {}

  private async guild(): Promise<Guild | null> {
    return (
      this.client.guilds.cache.get(this.guildId) ??
      (await this.client.guilds.fetch(this.guildId).catch(() => null))
    );
  }

  private async member(guild: Guild, userId: string): Promise<GuildMember | null> {
    return (
      guild.members.cache.get(userId) ??
      (await guild.members.fetch(userId).catch(() => null))
    );
  }

  async checkAssignable(roleId: string): Promise<RoleCheck> {
    const guild = await this.guild();
    if (!guild) {
      return { ok: false, reason: "cannot_assign" };
    }
    const role =
      guild.roles.cache.get(roleId) ??
      (await guild.roles.fetch(roleId).catch(() => null));
    if (!role) {
      return { ok: false, reason: "role_missing" };
    }
    // Checked again at purchase time: an admin may have added powers to the
    // role after it was put on sale.
    if (
      role.managed ||
      !role.editable ||
      elevatedPermissionsOf(role.permissions.toArray()).length > 0
    ) {
      return { ok: false, reason: "cannot_assign" };
    }
    return { ok: true };
  }

  async equip(
    userId: string,
    roleId: string,
    removeRoleIds: readonly string[],
  ): Promise<RoleChangeResult> {
    const guild = await this.guild();
    const member = guild ? await this.member(guild, userId) : null;
    if (!member) {
      return { ok: false, reason: "member_missing" };
    }
    try {
      // Add the new color first, so a failure never leaves the member with none.
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, "Color shop: color put on");
      }
      const remove = removeRoleIds.filter(
        (id) => id !== roleId && member.roles.cache.has(id),
      );
      if (remove.length > 0) {
        await member.roles.remove(remove, "Color shop: switched color");
      }
      return { ok: true };
    } catch (error) {
      logger.warn({ err: error, roleId }, "The color shop could not change a member's roles.");
      return { ok: false, reason: classify(error) };
    }
  }

  async unequip(userId: string, roleIds: readonly string[]): Promise<RoleChangeResult> {
    const guild = await this.guild();
    const member = guild ? await this.member(guild, userId) : null;
    if (!member) {
      return { ok: false, reason: "member_missing" };
    }
    try {
      const remove = roleIds.filter((id) => member.roles.cache.has(id));
      if (remove.length > 0) {
        await member.roles.remove(remove, "Color shop: color taken off");
      }
      return { ok: true };
    } catch (error) {
      logger.warn({ err: error }, "The color shop could not remove a member's color.");
      return { ok: false, reason: classify(error) };
    }
  }

  async worn(userId: string, candidateRoleIds: readonly string[]): Promise<string[] | null> {
    const guild = await this.guild();
    const member = guild ? await this.member(guild, userId) : null;
    if (!member) {
      return null;
    }
    return candidateRoleIds.filter((id) => member.roles.cache.has(id));
  }
}
