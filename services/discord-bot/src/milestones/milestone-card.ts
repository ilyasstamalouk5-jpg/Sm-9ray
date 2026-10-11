import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { logger } from "../config/logger.js";
import { buildCardData, type CardInput } from "./milestone-card-data.js";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  drawMilestoneCard,
  type Ctx2D,
} from "./milestone-card-draw.js";

const FONT_DIR = new URL("../../assets/fonts/", import.meta.url);
const BACKGROUND_FILE = new URL("../../assets/milestone-card-bg.jpg", import.meta.url);
const IMAGE_TIMEOUT_MS = 6_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type CanvasModule = typeof import("@napi-rs/canvas");
let canvasModule: Promise<CanvasModule> | null = null;

export function loadCanvas(): Promise<CanvasModule> {
  canvasModule ??= import("@napi-rs/canvas").then((module) => {
    const fonts: Array<[string, string]> = [
      [FONT_BOLD, "Poppins-Bold.ttf"],
      [FONT_MEDIUM, "Poppins-Medium.ttf"],
      [FONT_REGULAR, "Poppins-Regular.ttf"],
    ];
    for (const [family, file] of fonts) {
      module.GlobalFonts.registerFromPath(
        fileURLToPath(new URL(file, FONT_DIR)),
        family,
      );
    }
    return module;
  });
  return canvasModule;
}

export async function downloadImage(url: string | null): Promise<Buffer | null> {
  if (!url) {
    return null;
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength <= MAX_IMAGE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export type CardImageUrls = {
  avatarUrl: string | null;
  coinUrl: string | null;
};

/**
 * Draws the milestone card and returns it as a PNG. Throws if the drawing
 * library is unavailable; the caller then posts the embed without a picture.
 * A missing avatar or coin image never stops the card from being drawn.
 */
export async function renderMilestoneCard(
  input: CardInput,
  images: CardImageUrls,
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
      logger.warn({ err: error }, "A card image could not be decoded; skipping it.");
      return null;
    }
  };
  const [avatar, coin] = await Promise.all([load(avatarBytes), load(coinBytes)]);
  const background = await readFile(BACKGROUND_FILE)
    .then((bytes) => canvasLib.loadImage(bytes))
    .catch((error) => {
      logger.warn({ err: error }, "The card background could not be loaded; using a plain one.");
      return null;
    });

  const canvas = canvasLib.createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawMilestoneCard(ctx, buildCardData(input), { background, avatar, coin });
  return canvas.toBuffer("image/png");
}
