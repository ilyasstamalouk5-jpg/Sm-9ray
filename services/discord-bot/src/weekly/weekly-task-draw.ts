// Draws the weekly task card in the same black-and-gold style as /shop.
// Only standard 2D canvas calls, so it runs with @napi-rs/canvas and in tests.

import {
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  GOLD,
  ellipsize,
  fitFont,
  goldGradient,
  roundedRect,
  text,
  type Ctx2D,
} from "../milestones/milestone-card-draw.js";
import type { WeeklyCardData } from "./weekly-task-rules.js";

export const WEEKLY_CARD_WIDTH = 1376;
export const WEEKLY_CARD_HEIGHT = 640;

const TAN = "#e6cc94";
const SUBTITLE = "#bfa979";
const MUTED = "#a8a396";
const BORDER = "#4a3b17";
const ENDED_GRAY = "#8a867a";

const PAD = 80;

function fitted(
  ctx: Ctx2D,
  value: string,
  x: number,
  y: number,
  family: string,
  maxWidth: number,
  size: number,
  minSize: number,
  fill: string | ReturnType<typeof goldGradient>,
  align: "left" | "center" | "right" = "left",
): void {
  const finalSize = fitFont(ctx, value, family, maxWidth, size, minSize);
  ctx.font = `${finalSize}px ${family}`;
  text(ctx, ellipsize(ctx, value, maxWidth), x, y, `${finalSize}px ${family}`, fill, align);
}

/** Splits text into at most `maxLines` lines that each fit `maxWidth`. */
export function wrapLines(ctx: Ctx2D, value: string, maxWidth: number, maxLines: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (ctx.measureText(attempt).width <= maxWidth || !current) {
      current = attempt;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) {
    lines.push(current);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`, maxWidth);
    return kept;
  }
  return lines.map((line) => ellipsize(ctx, line, maxWidth));
}

function statPanel(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  sub: string,
  dim: boolean,
  gold: boolean,
): void {
  const panel = ctx.createLinearGradient(x, y, x, y + h);
  panel.addColorStop(0, "#18150c");
  panel.addColorStop(1, "#0c0c0b");
  roundedRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = panel;
  ctx.fill();
  roundedRect(ctx, x, y, w, h, 20);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  text(ctx, label, x + 28, y + 42, `15px ${FONT_BOLD}`, dim ? ENDED_GRAY : GOLD);
  fitted(
    ctx,
    value,
    x + 28,
    y + 92,
    FONT_BOLD,
    w - 56,
    38,
    18,
    dim ? ENDED_GRAY : gold ? goldGradient(ctx, x + 28, y + 56, x + w - 28, y + 96) : TAN,
  );
  fitted(ctx, sub, x + 28, y + 124, FONT_REGULAR, w - 56, 16, 11, MUTED);
}

export function drawWeeklyTaskCard(ctx: Ctx2D, data: WeeklyCardData): void {
  const W = WEEKLY_CARD_WIDTH;
  const H = WEEKLY_CARD_HEIGHT;
  const dim = data.ended;

  // Background with a soft gold glow at the top.
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700);
  glow.addColorStop(0, dim ? "rgba(140,140,140,0.10)" : "rgba(217,180,90,0.16)");
  glow.addColorStop(1, "rgba(217,180,90,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Double frame.
  roundedRect(ctx, 22, 22, W - 44, H - 44, 30);
  ctx.strokeStyle = dim ? "#4a463c" : goldGradient(ctx, 22, 22, W - 22, H - 22);
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRect(ctx, 36, 36, W - 72, H - 72, 22);
  ctx.strokeStyle = "#3b2f12";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header: server line on the left, status pill on the right.
  fitted(ctx, data.kicker, PAD, 100, FONT_MEDIUM, 760, 18, 11, SUBTITLE);
  const pillW = 190;
  roundedRect(ctx, W - PAD - pillW, 70, pillW, 44, 22);
  if (dim) {
    ctx.strokeStyle = "#4a463c";
  } else {
    ctx.strokeStyle = goldGradient(ctx, W - PAD - pillW, 70, W - PAD, 114);
  }
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, data.statusLabel, W - PAD - pillW / 2, 99, `17px ${FONT_BOLD}`, dim ? ENDED_GRAY : TAN, "center");

  // Title and description.
  fitted(
    ctx,
    data.title,
    PAD,
    190,
    FONT_BOLD,
    W - 2 * PAD,
    64,
    28,
    dim ? ENDED_GRAY : goldGradient(ctx, PAD, 130, W - PAD, 190),
  );
  ctx.font = `22px ${FONT_REGULAR}`;
  const lines = wrapLines(ctx, data.description, W - 2 * PAD, 2);
  lines.forEach((line, index) => {
    text(ctx, line, PAD, 238 + index * 32, `22px ${FONT_REGULAR}`, MUTED);
  });

  // Three panels: goal, reward, deadline.
  const gap = 24;
  const panelW = (W - 2 * PAD - 2 * gap) / 3;
  const panelY = 318;
  const panelH = 158;
  statPanel(ctx, PAD, panelY, panelW, panelH, "GOAL", data.goalValue, data.goalSub, dim, false);
  statPanel(ctx, PAD + panelW + gap, panelY, panelW, panelH, "REWARD", data.rewardValue, data.rewardSub, dim, true);
  statPanel(ctx, PAD + 2 * (panelW + gap), panelY, panelW, panelH, "DEADLINE", data.deadlineValue, data.deadlineSub, dim, false);

  // Footer bar: how it works on the left, completions on the right.
  const footY = 508;
  roundedRect(ctx, PAD, footY, W - 2 * PAD, 62, 18);
  ctx.fillStyle = "#0e0c07";
  ctx.fill();
  roundedRect(ctx, PAD, footY, W - 2 * PAD, 62, 18);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  fitted(ctx, data.howText, PAD + 30, footY + 39, FONT_MEDIUM, 620, 20, 12, dim ? ENDED_GRAY : TAN);
  fitted(ctx, data.completedText, W - PAD - 30, footY + 39, FONT_BOLD, 420, 22, 12, dim ? ENDED_GRAY : goldGradient(ctx, W - 450, footY + 15, W - PAD - 30, footY + 45), "right");
}
