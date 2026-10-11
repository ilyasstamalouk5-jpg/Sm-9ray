import { readFile } from "node:fs/promises";
import { logger } from "../config/logger.js";
import { downloadImage, loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import { buildProfileCardData, type ProfileCardInput } from "./profile-card-data.js";
import {
  PROFILE_CARD_HEIGHT,
  PROFILE_CARD_WIDTH,
  drawProfileCard,
} from "./profile-card-draw.js";

const BACKGROUND_FILE = new URL("../../assets/profile-card-bg.jpg", import.meta.url);

export type ProfileCardImageUrls = {
  avatarUrl: string | null;
  coinUrl: string | null;
};

/**
 * Draws the profile card and returns it as a PNG. Throws if the drawing library
 * is unavailable; the caller then falls back to the text embed. A missing
 * avatar, coin or background never stops the card from being drawn.
 */
export async function renderProfileCard(
  input: ProfileCardInput,
  images: ProfileCardImageUrls,
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
      logger.warn({ err: error }, "A profile card image could not be decoded; skipping it.");
      return null;
    }
  };
  const [avatar, coin] = await Promise.all([load(avatarBytes), load(coinBytes)]);
  const background = await readFile(BACKGROUND_FILE)
    .then((bytes) => canvasLib.loadImage(bytes))
    .catch((error) => {
      logger.warn({ err: error }, "The profile card background could not be loaded; using a plain one.");
      return null;
    });

  const canvas = canvasLib.createCanvas(PROFILE_CARD_WIDTH, PROFILE_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawProfileCard(ctx, buildProfileCardData(input), { background, avatar, coin });
  return canvas.toBuffer("image/png");
}
