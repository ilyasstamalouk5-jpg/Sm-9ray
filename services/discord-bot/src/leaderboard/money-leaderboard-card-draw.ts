// Draws the /topmoney card on top of the layout artwork
// (assets/money-leaderboard-card-bg.jpg). The artwork already contains the
// title, the frames, the empty avatar rings, the medals and the fixed labels
// ("#1 CHAMPION", "TOTAL NET WORTH", "#2 RANK", "#3 RANK", "YOUR CURRENT
// STANDING"). Every changing piece of text was removed from it, so this only
// places avatars, names and amounts inside those shapes. Uses only standard
// 2D canvas calls.

import {
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  fitFont,
  text,
  type Ctx2D,
} from "../milestones/milestone-card-draw.js";
import { drawAvatar, drawFitted, gold, restoreBadge } from "./leaderboard-card-draw.js";
import type { MoneyCardData, MoneyCardEntry } from "./money-leaderboard-card-data.js";

export const MONEY_CARD_WIDTH = 1376;
export const MONEY_CARD_HEIGHT = 768;

export type MoneyCardImages = {
  background?: unknown | null;
  /** Loaded avatar images by rank (a missing rank gets a letter placeholder). */
  avatars: Map<number, unknown>;
  /** The viewer's avatar. */
  viewerAvatar: unknown | null;
};

const TAN = "#e6cc94";
const SUBTITLE = "#bfa979";
const PAGE_TEXT = "#dcc58f";
const MUTED = "#a8a396";

// Positions measured on the layout artwork.
const HERO_AVATAR = { x: 180, y: 219.5, r: 41 };
const HERO_NAME_X = 244;
const HERO_MEDAL = { x: 218.3, y: 260, r: 21.5 };
const MEDIUM = [
  { avatar: { x: 156.5, y: 474.5, r: 32.5 }, ball: { x: 183.5, y: 501.5, r: 15.5 }, left: 129, right: 356 },
  { avatar: { x: 432, y: 474.5, r: 32.5 }, ball: { x: 458.5, y: 501.5, r: 15.5 }, left: 403, right: 632 },
] as const;
const VIEWER_AVATAR = { x: 157, y: 670, r: 30 };

const ROW_Y0 = 122;
const ROW_PITCH = 88;
const ROW_H = 79;
const ROW_AVATAR_X = 869;
const ROW_COUNT = 7;
const BADGE_CENTER_X = 804;

function drawHero(ctx: Ctx2D, data: MoneyCardData, images: MoneyCardImages): void {
  const entry = data.slots[0];
  if (!entry) {
    return;
  }
  drawAvatar(ctx, HERO_AVATAR, images.avatars.get(entry.rank) ?? null, entry.initial);
  // The medal (with its printed "#1") sits on the avatar ring; put it back on top.
  restoreBadge(ctx, images.background, HERO_MEDAL);

  drawFitted(ctx, entry.name, HERO_NAME_X, 208, FONT_MEDIUM, 360, 28, 16, "#e8c680");
  if (data.heroCaption) {
    drawFitted(ctx, data.heroCaption, HERO_NAME_X, 234, FONT_REGULAR, 360, 15, 10, MUTED);
  }
  drawFitted(ctx, entry.amount, 153, 353, FONT_BOLD, 440, 36, 20, gold(ctx, 153, 322, 353, 360));
}

function drawMedium(
  ctx: Ctx2D,
  index: 0 | 1,
  entry: MoneyCardEntry | null,
  images: MoneyCardImages,
): void {
  const spot = MEDIUM[index];
  if (!entry) {
    return;
  }
  drawAvatar(ctx, spot.avatar, images.avatars.get(entry.rank) ?? null, entry.initial);
  // The small position ball (printed "2" or "3") sits on the ring; put it back on top.
  restoreBadge(ctx, images.background, spot.ball);

  const nameLeft = spot.avatar.x + spot.avatar.r + 13;
  drawFitted(ctx, entry.name, nameLeft, 479, FONT_MEDIUM, spot.right - nameLeft - 10, 20, 12, TAN);
  drawFitted(ctx, entry.amount, spot.left, 549, FONT_MEDIUM, spot.right - spot.left - 20, 24, 14, TAN);
}

function drawBadgeRank(ctx: Ctx2D, rowTop: number, rank: number): void {
  const label = `#${rank}`;
  const size = fitFont(ctx, label, FONT_MEDIUM, 28, 16, 10);
  text(ctx, label, BADGE_CENTER_X, rowTop + ROW_H / 2 + size * 0.36, `${size}px ${FONT_MEDIUM}`, "#c9ab68", "center");
}

function drawRows(ctx: Ctx2D, data: MoneyCardData, images: MoneyCardImages): void {
  for (let i = 0; i < ROW_COUNT; i += 1) {
    // An unused slot on a short page stays empty.
    const entry = data.slots[3 + i];
    if (!entry) {
      continue;
    }
    const top = ROW_Y0 + i * ROW_PITCH;
    const centerY = top + ROW_H / 2;
    drawBadgeRank(ctx, top, entry.rank);
    drawAvatar(
      ctx,
      { x: ROW_AVATAR_X, y: centerY, r: 25 },
      images.avatars.get(entry.rank) ?? null,
      entry.initial,
    );
    drawFitted(ctx, entry.name, 909, centerY + 7, FONT_MEDIUM, 330, 20, 12, TAN);
    drawFitted(ctx, entry.amount, 1288, centerY + 8, FONT_MEDIUM, 160, 22, 13, TAN, "right");
  }
}

function drawViewer(ctx: Ctx2D, data: MoneyCardData, images: MoneyCardImages): void {
  const viewer = data.viewer;
  if (!viewer) {
    return;
  }
  drawAvatar(ctx, VIEWER_AVATAR, images.viewerAvatar, viewer.initial);
  drawFitted(ctx, viewer.rankText, 203, 683, FONT_MEDIUM, 270, 24, 16, TAN);
  if (viewer.handle) {
    drawFitted(ctx, viewer.handle, 203, 713, FONT_REGULAR, 270, 14, 10, MUTED);
  }
  drawFitted(ctx, viewer.amount, 618, 679, FONT_MEDIUM, 190, 26, 14, TAN, "right");
}

export function drawMoneyLeaderboardCard(
  ctx: Ctx2D,
  data: MoneyCardData,
  images: MoneyCardImages,
): void {
  const W = MONEY_CARD_WIDTH;
  const H = MONEY_CARD_HEIGHT;

  if (images.background) {
    ctx.drawImage(images.background, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
  }

  // Header: the line under the title, and the page label in the pill.
  drawFitted(ctx, data.subtitle, 109, 101, FONT_MEDIUM, 540, 15, 10, SUBTITLE);
  text(ctx, data.pageLabel, 1239, 74, `17px ${FONT_MEDIUM}`, PAGE_TEXT, "center");

  drawHero(ctx, data, images);
  drawMedium(ctx, 0, data.slots[1] ?? null, images);
  drawMedium(ctx, 1, data.slots[2] ?? null, images);
  drawViewer(ctx, data, images);
  drawRows(ctx, data, images);
}
