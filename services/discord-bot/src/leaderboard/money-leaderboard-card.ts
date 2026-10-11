import { readFile } from "node:fs/promises";
import { logger } from "../config/logger.js";
import { downloadImage, loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import { buildMoneyCardData, type MoneyCardInput } from "./money-leaderboard-card-data.js";
import {
  MONEY_CARD_HEIGHT,
  MONEY_CARD_WIDTH,
  drawMoneyLeaderboardCard,
} from "./money-leaderboard-card-draw.js";

const BACKGROUND_FILE = new URL("../../assets/money-leaderboard-card-bg.jpg", import.meta.url);

/**
 * Draws the richest-members card and returns it as a PNG. Throws if the
 * drawing library is unavailable; the caller then falls back to the text
 * embed. A missing or broken avatar never stops the card from being drawn.
 */
export async function renderMoneyLeaderboardCard(input: MoneyCardInput): Promise<Buffer> {
  const canvasLib = await loadCanvas();

  const load = async (url: string | null) => {
    const bytes = await downloadImage(url);
    if (!bytes) {
      return null;
    }
    try {
      return await canvasLib.loadImage(bytes);
    } catch (error) {
      logger.warn({ err: error }, "A money leaderboard avatar could not be decoded; using a letter.");
      return null;
    }
  };

  const [loaded, viewerAvatar, background] = await Promise.all([
    Promise.all(
      [...input.podium, ...input.rows].map(async (member) => [member.rank, await load(member.avatarUrl)] as const),
    ),
    load(input.viewer?.avatarUrl ?? null),
    readFile(BACKGROUND_FILE)
      .then((bytes) => canvasLib.loadImage(bytes))
      .catch((error) => {
        logger.warn({ err: error }, "The money leaderboard background could not be loaded; using a plain one.");
        return null;
      }),
  ]);

  const avatars = new Map<number, unknown>();
  for (const [rank, image] of loaded) {
    if (image) {
      avatars.set(rank, image);
    }
  }

  const canvas = canvasLib.createCanvas(MONEY_CARD_WIDTH, MONEY_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawMoneyLeaderboardCard(ctx, buildMoneyCardData(input), { background, avatars, viewerAvatar });
  return canvas.toBuffer("image/png");
}
