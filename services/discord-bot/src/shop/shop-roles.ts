// How the shop gives and takes color roles. The real implementation talks to
// Discord (discord-shop-roles.ts); tests use a small fake.

export type RoleCheck =
  | { ok: true }
  | { ok: false; reason: "role_missing" | "cannot_assign" };

export type RoleChangeResult =
  | { ok: true }
  | { ok: false; reason: "member_missing" | "denied" | "failed" };

export interface ShopRoleOperations {
  /** Can the bot hand out this role right now? Checked BEFORE anyone is charged. */
  checkAssignable(roleId: string): Promise<RoleCheck>;
  /**
   * Gives `roleId` and removes every role in `removeRoleIds` the member has,
   * so a member wears one shop color at a time.
   */
  equip(userId: string, roleId: string, removeRoleIds: readonly string[]): Promise<RoleChangeResult>;
  /** Removes every listed role the member has. */
  unequip(userId: string, roleIds: readonly string[]): Promise<RoleChangeResult>;
  /** Which of `candidateRoleIds` the member wears now, or null if unknown. */
  worn(userId: string, candidateRoleIds: readonly string[]): Promise<string[] | null>;
}
