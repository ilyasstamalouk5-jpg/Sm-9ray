import { readFile } from "node:fs/promises";
import { logger } from "../config/logger.js";
import { downloadImage, loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import {
  buildLeaderboardCardData,
  type LeaderboardCardInput,
} from "./leaderboard-card-data.js";
import {
  LEADERBOARD_CARD_HEIGHT,
  LEADERBOARD_CARD_WIDTH,
  drawLeaderboardCard,
} from "./leaderboard-card-draw.js";

const BACKGROUND_FILE = new URL("../../assets/leaderboard-card-bg.jpg", import.meta.url);

/**
 * Draws the voice leaderboard card and returns it as a PNG. Throws if the
 * drawing library is unavailable; the caller then falls back to the text
 * embed. A missing or broken avatar never stops the card from being drawn.
 */
export async function renderLeaderboardCard(input: LeaderboardCardInput): Promise<Buffer> {
  const canvasLib = await loadCanvas();

  const load = async (url: string | null) => {
    const bytes = await downloadImage(url);
    if (!bytes) {
      return null;
    }
    try {
      return await canvasLib.loadImage(bytes);
    } catch (error) {
      logger.warn({ err: error }, "A leaderboard avatar could not be decoded; using a letter.");
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
        logger.warn({ err: error }, "The leaderboard background could not be loaded; using a plain one.");
        return null;
      }),
  ]);

  const avatars = new Map<number, unknown>();
  for (const [rank, image] of loaded) {
    if (image) {
      avatars.set(rank, image);
    }
  }

  const canvas = canvasLib.createCanvas(LEADERBOARD_CARD_WIDTH, LEADERBOARD_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawLeaderboardCard(ctx, buildLeaderboardCardData(input), { background, avatars, viewerAvatar });
  return canvas.toBuffer("image/png");
}
