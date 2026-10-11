// Draws the milestone card using only standard 2D canvas calls, so the same
// code works with @napi-rs/canvas in the bot and with a browser canvas in tests.

import type { CardData } from "./milestone-card-data.js";

export const CARD_WIDTH = 1248;
export const CARD_HEIGHT = 848;

export const FONT_BOLD = "PoppinsBold";
export const FONT_MEDIUM = "PoppinsMedium";
export const FONT_REGULAR = "PoppinsRegular";

export type Gradient = { addColorStop(offset: number, color: string): void };

export interface Ctx2D {
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient;
  createRadialGradient(
    x0: number, y0: number, r0: number, x1: number, y1: number, r1: number,
  ): Gradient;
}

export type CardImages = {
  /** The card background artwork (frame, panels and ring are part of it). */
  background?: unknown | null;
  /** The member's avatar (any drawable image), or null for a placeholder. */
  avatar: unknown | null;
  /** The Dirham coin (optional). */
  coin: unknown | null;
};

export const GOLD = "#d9b45a";
export const GOLD_LIGHT = "#f3da8f";
export const GOLD_DARK = "#8a6a25";
export const WHITE = "#ffffff";
export const GRAY = "#b9b4a8";
export const GREEN = "#37c871";

export function goldGradient(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): Gradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, GOLD_LIGHT);
  gradient.addColorStop(0.5, GOLD);
  gradient.addColorStop(1, GOLD_DARK);
  return gradient;
}

export function roundedRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Shrinks the font size until the text fits `maxWidth`. */
export function fitFont(ctx: Ctx2D, text: string, family: string, maxWidth: number, size: number, minSize: number): number {
  let current = size;
  ctx.font = `${current}px ${family}`;
  while (current > minSize && ctx.measureText(text).width > maxWidth) {
    current -= 2;
    ctx.font = `${current}px ${family}`;
  }
  return current;
}

/** Cuts text with "…" if it still does not fit at the current font. */
export function ellipsize(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}…`;
}

export function text(
  ctx: Ctx2D,
  value: string,
  x: number,
  y: number,
  font: string,
  fill: string | Gradient,
  align: "left" | "center" | "right" = "left",
): void {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, y);
}

function crown(ctx: Ctx2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = goldGradient(ctx, x, y, x + w, y + h);
  const baseTop = y + h * 0.72;
  ctx.beginPath();
  ctx.moveTo(x, baseTop);
  ctx.lineTo(x + w * 0.04, y + h * 0.22);
  ctx.lineTo(x + w * 0.27, y + h * 0.48);
  ctx.lineTo(x + w * 0.5, y + h * 0.08);
  ctx.lineTo(x + w * 0.73, y + h * 0.48);
  ctx.lineTo(x + w * 0.96, y + h * 0.22);
  ctx.lineTo(x + w, baseTop);
  ctx.closePath();
  ctx.fill();
  for (const [cx, cy] of [
    [x + w * 0.04, y + h * 0.2],
    [x + w * 0.5, y + h * 0.06],
    [x + w * 0.96, y + h * 0.2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, h * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  roundedRect(ctx, x, baseTop + h * 0.06, w, h * 0.09, 3);
  ctx.fill();
  roundedRect(ctx, x, baseTop + h * 0.2, w, h * 0.09, 3);
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the milestone card on top of the background artwork. The artwork
 * (assets/milestone-card-bg.jpg) already contains the gold frame, the top pill,
 * the avatar ring, the role bar with its bracket and the two bottom panels, so
 * this only places the text, avatar, crown and coin inside those shapes.
 */
export function drawMilestoneCard(ctx: Ctx2D, data: CardData, images: CardImages): void {
  const W = CARD_WIDTH;
  const H = CARD_HEIGHT;

  // Background artwork (plain dark fill if it could not be loaded)
  if (images.background) {
    ctx.drawImage(images.background, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
  }

  // Top pill: server name (pill spans x 392-857, y 29-62)
  const pillText = `${data.serverName.toUpperCase()} • MILESTONE UNLOCKED`;
  const pillSize = fitFont(ctx, pillText, FONT_MEDIUM, 430, 19, 10);
  ctx.font = `${pillSize}px ${FONT_MEDIUM}`;
  text(ctx, ellipsize(ctx, pillText, 430), W / 2, 51, `${pillSize}px ${FONT_MEDIUM}`, GOLD_LIGHT, "center");

  // Title and subtitle, between the pill and the avatar ring
  text(ctx, "CONGRATULATIONS!", W / 2, 128, `64px ${FONT_BOLD}`, WHITE, "center");
  text(
    ctx,
    "You have unlocked a prestigious new role for your dedication",
    W / 2, 163, `19px ${FONT_REGULAR}`, GRAY, "center",
  );

  // Avatar inside the ring (ring centre 623.5, 268; opening radius about 60)
  const ax = 623.5;
  const ay = 268;
  const ar = 60;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax, ay, ar, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (images.avatar) {
    ctx.drawImage(images.avatar, ax - ar, ay - ar, ar * 2, ar * 2);
  } else {
    ctx.fillStyle = "#1b2a2a";
    ctx.fillRect(ax - ar, ay - ar, ar * 2, ar * 2);
    const initial = (data.handle.replace("@", "").charAt(0) || "?").toUpperCase();
    text(ctx, initial, ax, ay + 22, `60px ${FONT_BOLD}`, GOLD_LIGHT, "center");
  }
  ctx.restore();
  const handleSize = fitFont(ctx, data.handle, FONT_MEDIUM, 520, 20, 12);
  text(ctx, data.handle, W / 2, 372, `${handleSize}px ${FONT_MEDIUM}`, "#d8d4c8", "center");

  // Role bar (spans x 100-1148, y 424-599)
  crown(ctx, 132, 472, 122, 84);
  const titleMax = 580;
  const titleSize = fitFont(ctx, data.roleTitle, FONT_BOLD, titleMax, 54, 26);
  ctx.font = `${titleSize}px ${FONT_BOLD}`;
  text(ctx, ellipsize(ctx, data.roleTitle, titleMax), 284, 499, `${titleSize}px ${FONT_BOLD}`, WHITE);
  text(ctx, "ROLE UNLOCKED", 284, 528, `17px ${FONT_BOLD}`, goldGradient(ctx, 284, 514, 420, 534));
  const reqLine = `Milestone Requirement: ${data.requirementText}`;
  const reqSize = fitFont(ctx, reqLine, FONT_REGULAR, 590, 21, 14);
  text(ctx, reqLine, 284, 564, `${reqSize}px ${FONT_REGULAR}`, GRAY);

  // Milestone badge inside the bracket (x 942-1120, y 448-575)
  const bx = 942;
  const by = 448;
  const bw = 178;
  const bh = 127;
  text(ctx, "MILESTONE", bx + bw / 2, by + 34, `17px ${FONT_BOLD}`, GOLD, "center");
  const hoursSize = fitFont(ctx, data.hoursLabel, FONT_BOLD, bw - 40, 54, 26);
  text(ctx, data.hoursLabel, bx + bw / 2, by + 90, `${hoursSize}px ${FONT_BOLD}`, WHITE, "center");
  text(ctx, "COMPLETED", bx + bw / 2, by + bh - 10, `16px ${FONT_BOLD}`, GREEN, "center");

  // Bottom panels (x 100-612 and 636-1148, y 622-786)
  const boxY = 622;
  const boxW = 512;

  // Reward (left)
  text(ctx, "MILESTONE BONUS REWARD", 130, boxY + 42, `17px ${FONT_BOLD}`, GOLD);
  const coinSpace = data.hasReward && images.coin ? 96 : 0;
  const rewardMax = boxW - 60 - coinSpace;
  const rewardSize = fitFont(ctx, data.rewardTitle, FONT_BOLD, rewardMax, 50, 26);
  text(ctx, data.rewardTitle, 130, boxY + 100, `${rewardSize}px ${FONT_BOLD}`, WHITE);
  const rewardSubSize = fitFont(ctx, data.rewardSub, FONT_REGULAR, boxW - 60, 20, 13);
  text(ctx, data.rewardSub, 130, boxY + 139, `${rewardSubSize}px ${FONT_REGULAR}`, GRAY);
  if (coinSpace > 0) {
    ctx.save();
    ctx.shadowColor = "rgba(243,218,143,0.5)";
    ctx.shadowBlur = 16;
    ctx.drawImage(images.coin, 100 + boxW - 30 - 78, boxY + 32, 78, 78);
    ctx.restore();
  }

  // Next milestone (right)
  text(ctx, "NEXT MILESTONE TARGET", 666, boxY + 42, `17px ${FONT_BOLD}`, GOLD);
  const nextSize = fitFont(ctx, data.nextTitle, FONT_BOLD, boxW - 60, 50, 24);
  ctx.font = `${nextSize}px ${FONT_BOLD}`;
  text(ctx, ellipsize(ctx, data.nextTitle, boxW - 60), 666, boxY + 100, `${nextSize}px ${FONT_BOLD}`, WHITE);
  const nextSubSize = fitFont(ctx, data.nextSub, FONT_REGULAR, boxW - 60, 20, 13);
  text(ctx, data.nextSub, 666, boxY + 139, `${nextSubSize}px ${FONT_REGULAR}`, GRAY);
}
