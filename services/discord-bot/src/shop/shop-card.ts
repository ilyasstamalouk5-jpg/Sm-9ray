import { loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import { buildShopCardData, type ShopCardInput } from "./shop-card-data.js";
import { SHOP_CARD_HEIGHT, SHOP_CARD_WIDTH, drawShopCard } from "./shop-card-draw.js";

/**
 * Draws the /shop card and returns it as a PNG. Throws if the drawing library
 * is unavailable; the caller then falls back to a text embed.
 */
export async function renderShopCard(input: ShopCardInput): Promise<Buffer> {
  const canvasLib = await loadCanvas();
  const canvas = canvasLib.createCanvas(SHOP_CARD_WIDTH, SHOP_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawShopCard(ctx, buildShopCardData(input));
  return canvas.toBuffer("image/png");
}
