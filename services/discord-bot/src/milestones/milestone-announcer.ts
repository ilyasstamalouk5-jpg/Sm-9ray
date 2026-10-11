import {
  AttachmentBuilder,
  EmbedBuilder,
  type Client,
  type Guild,
} from "discord.js";
import { logger } from "../config/logger.js";
import { buildAnnouncementDescription } from "./milestone-card-data.js";
import { renderMilestoneCard } from "./milestone-card.js";
import type { MilestoneAnnouncement, MilestoneAnnouncer } from "./milestone-manager.js";
import type { MilestoneDefinition } from "./types.js";

export type AnnouncerOptions = {
  guildId: string;
  channelId: string;
  bullet: string;
  currencySymbol: string;
  /** The live milestone list (admin edits are picked up automatically). */
  definitions: readonly MilestoneDefinition[];
  currencyImageUrl: () => Promise<string | null>;
};

const CARD_FILE = "milestone-card.png";

/**
 * Posts the "Congratulations!" embed and card in the announcement channel when
 * a member newly reaches a milestone.
 */
export class DiscordMilestoneAnnouncer implements MilestoneAnnouncer {
  constructor(
    private readonly client: Client,
    private readonly options: AnnouncerOptions,
  ) {}

  async announce(event: MilestoneAnnouncement): Promise<void> {
    const guild: Guild | null =
      this.client.guilds.cache.get(this.options.guildId) ??
      (await this.client.guilds.fetch(this.options.guildId).catch(() => null));
    if (!guild) {
      return;
    }
    const member =
      guild.members.cache.get(event.discordUserId) ??
      (await guild.members.fetch(event.discordUserId).catch(() => null));
    if (!member || member.user.bot) {
      return;
    }
    const channel =
      guild.channels.cache.get(this.options.channelId) ??
      (await guild.channels.fetch(this.options.channelId).catch(() => null));
    if (!channel || !channel.isTextBased() || !("send" in channel)) {
      logger.warn("The milestone announcement channel is missing or not a text channel.");
      return;
    }

    const roleName = event.milestone.roleId
      ? (guild.roles.cache.get(event.milestone.roleId)?.name ?? null)
      : null;
    const ordered = [...this.options.definitions].sort(
      (left, right) => left.requiredVoiceTimeSeconds - right.requiredVoiceTimeSeconds,
    );
    const next =
      ordered.find(
        (candidate) =>
          candidate.requiredVoiceTimeSeconds > event.milestone.requiredVoiceTimeSeconds,
      ) ?? null;
    const nextRoleName = next?.roleId
      ? (guild.roles.cache.get(next.roleId)?.name ?? null)
      : null;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("🎉 Congratulations!")
      .setDescription(
        buildAnnouncementDescription({
          bullet: this.options.bullet,
          memberId: member.id,
          roleId: event.milestone.roleId,
          requiredVoiceTimeSeconds: event.milestone.requiredVoiceTimeSeconds,
          rewardAmount: event.milestone.currencyRewardAmount,
          currencySymbol: this.options.currencySymbol,
        }),
      );

    const files: AttachmentBuilder[] = [];
    try {
      const coinUrl =
        event.milestone.currencyRewardAmount && event.milestone.currencyRewardAmount > 0
          ? await this.options.currencyImageUrl()
          : null;
      const png = await renderMilestoneCard(
        {
          serverName: guild.name,
          username: member.user.username,
          roleName,
          milestone: {
            id: event.milestone.id,
            requiredVoiceTimeSeconds: event.milestone.requiredVoiceTimeSeconds,
            currencyRewardAmount: event.milestone.currencyRewardAmount,
          },
          next: next
            ? {
                id: next.id,
                roleName: nextRoleName,
                requiredVoiceTimeSeconds: next.requiredVoiceTimeSeconds,
              }
            : null,
          totalSeconds: event.totalSeconds,
          currencySymbol: this.options.currencySymbol,
        },
        {
          avatarUrl: member.displayAvatarURL({ extension: "png", size: 256 }),
          coinUrl,
        },
      );
      files.push(new AttachmentBuilder(png, { name: CARD_FILE }));
      embed.setImage(`attachment://${CARD_FILE}`);
    } catch (error) {
      // The text announcement is still worth posting without the picture.
      logger.error({ err: error }, "Could not draw the milestone card; posting without it.");
    }

    await channel.send({
      embeds: [embed],
      files,
      allowedMentions: { parse: [] },
    });
  }
}
