import { loadCanvas } from "../milestones/milestone-card.js";
import type { Ctx2D } from "../milestones/milestone-card-draw.js";
import { WEEKLY_CARD_HEIGHT, WEEKLY_CARD_WIDTH, drawWeeklyTaskCard } from "./weekly-task-draw.js";
import { buildWeeklyCardData, type WeeklyCardInput } from "./weekly-task-rules.js";

/**
 * Draws the weekly task card and returns it as a PNG. Throws if the drawing
 * library is unavailable; the caller then posts the embed without a picture.
 */
export async function renderWeeklyTaskCard(input: WeeklyCardInput): Promise<Buffer> {
  const canvasLib = await loadCanvas();
  const canvas = canvasLib.createCanvas(WEEKLY_CARD_WIDTH, WEEKLY_CARD_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D;
  drawWeeklyTaskCard(ctx, buildWeeklyCardData(input));
  return canvas.toBuffer("image/png");
}
