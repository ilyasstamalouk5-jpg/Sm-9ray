// Draws the /voicestats activity card on top of the background artwork
// (assets/activity-card-bg.jpg). The artwork already contains the frame, the
// avatar ring, the six stat boxes with their labels and icons, the empty
// calendar squares and the four bottom boxes, so this only places text, the
// avatar, the coin and the calendar gems inside those shapes. Uses only
// standard 2D canvas calls, so the same code runs with @napi-rs/canvas in the
// bot and with a browser canvas when previewing.

import {
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  GOLD_LIGHT,
  ellipsize,
  fitFont,
  roundedRect,
  text,
  type Ctx2D,
  type Gradient,
} from "../milestones/milestone-card-draw.js";
import {
  CALENDAR_ROWS,
  CALENDAR_WEEKS,
  type ActivityCardData,
  type CalendarCell,
  type StatBox,
} from "./activity-data.js";

export const ACTIVITY_CARD_WIDTH = 1295;
export const ACTIVITY_CARD_HEIGHT = 816;

export type ActivityCardImages = {
  background?: unknown | null;
  /** The member's avatar, or null for a placeholder letter. */
  avatar: unknown | null;
  /** The currency coin (optional). */
  coin: unknown | null;
};

const MUTED = "#b4ae9f";
const SOFT_WHITE = "#ece6d6";

// Positions measured on the background artwork.
const AVATAR = { x: 79, y: 50, r: 28 };
const NAME_X = 121;
const PILL = { x: 1079, y: 32, w: 164, h: 36 };
const CARD_W = 385;
const CARD_COLUMNS = [52, 454, 856] as const;
const CARD_ROWS = [97, 230] as const;
const COIN_SLOT = { x: 1208, y: 130, r: 19 };
const GRID = { x: 95, y: 472, pitch: 24, cell: 20 };
const LEGEND = { x: 1007.5, y: 403, pitch: 20 };
const FOOTER_BOXES = [78, 366, 654, 942] as const;

function textGold(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number): Gradient {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, "#f8e3a0");
  gradient.addColorStop(0.55, "#e9bf5a");
  gradient.addColorStop(1, "#d3a23f");
  return gradient;
}

const TEAL_CENTER = ["#5fd9d4", "#6fe9e3", "#8ff5ee", "#c2fff9"] as const;
const TEAL_MID = ["#16888b", "#1a9c9f", "#1fb6b8", "#27d0cf"] as const;
const TEAL_EDGE = ["#093f47", "#0a4b53", "#0c5a61", "#0f6c73"] as const;

function sparkle(ctx: Ctx2D, x: number, y: number, size: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(255,244,200,0.9)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.16, y - size * 0.16);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x + size * 0.16, y + size * 0.16);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size * 0.16, y + size * 0.16);
  ctx.lineTo(x - size, y);
  ctx.lineTo(x - size * 0.16, y - size * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** One faceted gem. level 1..4 sets size and brightness; gold = today's gem. */
function drawGem(ctx: Ctx2D, cx: number, cy: number, level: number, gold: boolean): void {
  const i = Math.min(4, Math.max(1, level)) - 1;
  const r = 7.4 + i * 1.05;
  const center = gold ? "#fffdf0" : TEAL_CENTER[i]!;
  const mid = gold ? "#f4dc8f" : TEAL_MID[i]!;
  const edge = gold ? "#b98a2e" : TEAL_EDGE[i]!;

  ctx.save();
  if (level >= 3 || gold) {
    ctx.shadowColor = gold ? "rgba(255,215,120,0.85)" : "rgba(60,230,225,0.55)";
    ctx.shadowBlur = gold ? 12 : 8;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const body = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
  body.addColorStop(0, center);
  body.addColorStop(0.55, mid);
  body.addColorStop(1, edge);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.restore();

  // Facet lines
  ctx.save();
  ctx.strokeStyle = gold ? "rgba(150,110,30,0.35)" : "rgba(210,255,252,0.28)";
  ctx.lineWidth = 0.8;
  for (let k = 0; k < 8; k += 1) {
    const angle = (Math.PI / 4) * k + Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * r * 0.32, cy + Math.sin(angle) * r * 0.32);
    ctx.lineTo(cx + Math.cos(angle) * r * 0.88, cy + Math.sin(angle) * r * 0.88);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Gold bezel
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = gold ? "#fff3c4" : "#d2ac55";
  ctx.stroke();
  ctx.restore();
}

function drawCalendar(ctx: Ctx2D, data: ActivityCardData): void {
  text(ctx, "Activity calendar", 79, 401, `19px ${FONT_BOLD}`, "#f1e3b8");
  text(ctx, "Daily contribution & focus intensity.", 79, 423, `14px ${FONT_REGULAR}`, MUTED);

  // Legend: the five empty squares are in the artwork; the first one stays empty.
  text(ctx, "Less", 993, 408, `13px ${FONT_REGULAR}`, MUTED, "right");
  text(ctx, "More", 1103, 408, `13px ${FONT_REGULAR}`, MUTED, "left");
  for (let level = 1; level <= 4; level += 1) {
    drawGem(ctx, LEGEND.x + LEGEND.pitch * level, LEGEND.y, level, false);
  }

  for (const { column, label } of data.monthLabels) {
    text(ctx, label, GRID.x - GRID.cell / 2 + GRID.pitch * column, 452, `13px ${FONT_REGULAR}`, "#d3c59f");
  }

  const half = GRID.cell / 2;
  for (let column = 0; column < CALENDAR_WEEKS; column += 1) {
    const week: CalendarCell[] = data.cells[column] ?? [];
    for (let row = 0; row < CALENDAR_ROWS; row += 1) {
      const cell = week[row];
      if (!cell) {
        continue;
      }
      const cx = GRID.x + GRID.pitch * column;
      const cy = GRID.y + GRID.pitch * row;
      if (cell.level < 0) {
        // A day that has not happened yet: dim the square from the artwork.
        ctx.save();
        roundedRect(ctx, cx - half, cy - half, GRID.cell, GRID.cell, 4);
        ctx.fillStyle = "rgba(6,6,5,0.5)";
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (cell.level > 0) {
        drawGem(ctx, cx, cy, cell.level, cell.isToday);
        if (cell.isToday) {
          sparkle(ctx, cx + 8, cy - 8, 11);
        }
      }
      if (cell.isToday) {
        ctx.save();
        roundedRect(ctx, cx - half - 1.5, cy - half - 1.5, GRID.cell + 3, GRID.cell + 3, 5);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "rgba(243,218,143,0.9)";
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  data.footer.forEach((label, index) => {
    const x = FOOTER_BOXES[index]!;
    const size = fitFont(ctx, label, FONT_MEDIUM, 246, 15, 11);
    text(ctx, label, x + 137, 664, `${size}px ${FONT_MEDIUM}`, SOFT_WHITE, "center");
  });
}

function drawStat(
  ctx: Ctx2D,
  box: StatBox,
  x: number,
  y: number,
  options: { reserveRight?: number } = {},
): void {
  const left = x + 21;
  const maxWidth = CARD_W - 42 - (options.reserveRight ?? 0);
  const valueSize = fitFont(ctx, box.value, FONT_BOLD, maxWidth, 32, 20);
  ctx.font = `${valueSize}px ${FONT_BOLD}`;
  text(
    ctx,
    ellipsize(ctx, box.value, maxWidth),
    left, y + 72, `${valueSize}px ${FONT_BOLD}`,
    textGold(ctx, left, y + 44, left + 180, y + 76),
  );

  // Sub line: optional bold gold lead-in, then the muted rest.
  const subMax = CARD_W - 42;
  let subSize = 14.5;
  const subWidth = (size: number): number => {
    ctx.font = `${size}px ${FONT_BOLD}`;
    const bold = box.subBold ? ctx.measureText(box.subBold).width : 0;
    ctx.font = `${size}px ${FONT_REGULAR}`;
    return bold + ctx.measureText(box.sub).width;
  };
  while (subSize > 10 && subWidth(subSize) > subMax) {
    subSize -= 0.5;
  }
  ctx.font = `${subSize}px ${FONT_BOLD}`;
  const boldWidth = box.subBold ? ctx.measureText(box.subBold).width : 0;
  if (box.subBold) {
    text(ctx, box.subBold, left, y + 98, `${subSize}px ${FONT_BOLD}`, "#ecc766");
  }
  text(ctx, box.sub, left + boldWidth, y + 98, `${subSize}px ${FONT_REGULAR}`, MUTED);
}

export function drawActivityCard(
  ctx: Ctx2D,
  data: ActivityCardData,
  images: ActivityCardImages,
): void {
  const W = ACTIVITY_CARD_WIDTH;
  const H = ACTIVITY_CARD_HEIGHT;

  if (images.background) {
    ctx.drawImage(images.background, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
  }

  // Avatar inside the ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR.x, AVATAR.y, AVATAR.r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (images.avatar) {
    ctx.drawImage(images.avatar, AVATAR.x - AVATAR.r, AVATAR.y - AVATAR.r, AVATAR.r * 2, AVATAR.r * 2);
  } else {
    ctx.fillStyle = "#1b2a2a";
    ctx.fillRect(AVATAR.x - AVATAR.r, AVATAR.y - AVATAR.r, AVATAR.r * 2, AVATAR.r * 2);
    const initial = (data.name.charAt(0) || "?").toUpperCase();
    text(ctx, initial, AVATAR.x, AVATAR.y + 11, `30px ${FONT_BOLD}`, GOLD_LIGHT, "center");
  }
  ctx.restore();

  // Name (the "@server - #Academy" line under it is part of the artwork)
  const nameMax = 440;
  const nameSize = fitFont(ctx, data.name, FONT_BOLD, nameMax, 22, 14);
  ctx.font = `${nameSize}px ${FONT_BOLD}`;
  text(
    ctx,
    ellipsize(ctx, data.name, nameMax),
    NAME_X, 47, `${nameSize}px ${FONT_BOLD}`,
    textGold(ctx, NAME_X, 28, NAME_X + 240, 50),
  );

  // Pill, top right
  const pillSize = fitFont(ctx, data.pill, FONT_BOLD, PILL.w - 24, 13, 9);
  text(ctx, data.pill, PILL.x + PILL.w / 2, PILL.y + 23, `${pillSize}px ${FONT_BOLD}`, "#2b2110", "center");

  // Six stat boxes
  const boxes: StatBox[] = [data.streak, data.today, data.wallet, data.week, data.lifetime, data.activeDays];
  boxes.forEach((box, index) => {
    const x = CARD_COLUMNS[index % 3]!;
    const y = CARD_ROWS[Math.floor(index / 3)]!;
    drawStat(ctx, box, x, y, { reserveRight: 0 });
  });

  // Coin inside the wallet icon ring
  if (data.hasWallet) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(COIN_SLOT.x, COIN_SLOT.y, COIN_SLOT.r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (images.coin) {
      ctx.drawImage(images.coin, COIN_SLOT.x - COIN_SLOT.r, COIN_SLOT.y - COIN_SLOT.r, COIN_SLOT.r * 2, COIN_SLOT.r * 2);
    } else {
      const fill = ctx.createLinearGradient(COIN_SLOT.x - COIN_SLOT.r, COIN_SLOT.y - COIN_SLOT.r, COIN_SLOT.x + COIN_SLOT.r, COIN_SLOT.y + COIN_SLOT.r);
      fill.addColorStop(0, "#f8e3a0");
      fill.addColorStop(1, "#c8962f");
      ctx.fillStyle = fill;
      ctx.fillRect(COIN_SLOT.x - COIN_SLOT.r, COIN_SLOT.y - COIN_SLOT.r, COIN_SLOT.r * 2, COIN_SLOT.r * 2);
      text(ctx, "DH", COIN_SLOT.x, COIN_SLOT.y + 5, `13px ${FONT_BOLD}`, "#3a2a0c", "center");
    }
    ctx.restore();
  }

  drawCalendar(ctx, data);
}
