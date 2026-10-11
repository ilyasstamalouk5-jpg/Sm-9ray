import { readFile } from "node:fs/promises";
import { logger } from "../config/logger.js";
import { downloadImage, loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import { buildActivityCardData, type ActivityCardInput } from "./activity-data.js";
import {
  ACTIVITY_CARD_HEIGHT,
  ACTIVITY_CARD_WIDTH,
  drawActivityCard,
} from "./activity-card-draw.js";

const BACKGROUND_FILE = new URL("../../assets/activity-card-bg.jpg", import.meta.url);

export type ActivityCardImageUrls = {
  avatarUrl: string | null;
  coinUrl: string | null;
};

/**
 * Draws the activity card and returns it as a PNG. Throws if the drawing
 * library is unavailable; the caller then falls back to the text embed. A
 * missing avatar, coin or background never stops the card from being drawn.
 */
export async function renderActivityCard(
  input: ActivityCardInput,
  images: ActivityCardImageUrls,
): Promise<Buffer> {
  const canvasLib = await loadCanvas();
  const [avatarBytes, coinBytes] = await Promise.all([
    downloadImage(images.avatarUrl),
    downloadImage(images.coinUrl),
  ]);

  const load = async (bytes: Buffer | null) => {
    if (!bytes) {
      return null;
    }
    try {
      return await canvasLib.loadImage(bytes);
    } catch (error) {
      logger.warn({ err: error }, "An activity card image could not be decoded; skipping it.");
      return null;
    }
  };
  const [avatar, coin] = await Promise.all([load(avatarBytes), load(coinBytes)]);
  const background = await readFile(BACKGROUND_FILE)
    .then((bytes) => canvasLib.loadImage(bytes))
    .catch((error) => {
      logger.warn({ err: error }, "The activity card background could not be loaded; using a plain one.");
      return null;
    });

  const canvas = canvasLib.createCanvas(ACTIVITY_CARD_WIDTH, ACTIVITY_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawActivityCard(ctx, buildActivityCardData(input), { background, avatar, coin });
  return canvas.toBuffer("image/png");
}
