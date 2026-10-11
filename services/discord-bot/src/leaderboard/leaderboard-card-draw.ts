// Draws the /leaderboard card on top of the layout artwork
// (assets/leaderboard-card-bg.jpg). The artwork already contains the title, the
// frames, the empty avatar rings, the rank badges (#4 to #10) and the medals,
// so this only places avatars and text inside those shapes. The few
// placeholders that are part of the artwork (the "PAGE X / Y" label, and the
// little bar and empty pill in each row) are painted over first. Uses only
// standard 2D canvas calls.

import {
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  GOLD_LIGHT,
  WHITE,
  ellipsize,
  fitFont,
  roundedRect,
  text,
  type Ctx2D,
} from "../milestones/milestone-card-draw.js";
import type { LeaderboardCardData, LeaderboardCardEntry } from "./leaderboard-card-data.js";

export const LEADERBOARD_CARD_WIDTH = 1376;
export const LEADERBOARD_CARD_HEIGHT = 768;

export type LeaderboardCardImages = {
  background?: unknown | null;
  /** Loaded avatar images by rank (a missing rank gets a letter placeholder). */
  avatars: Map<number, unknown>;
  /** The viewer's avatar. */
  viewerAvatar: unknown | null;
};

const TAN = "#e6cc94";
const MUTED = "#a8a396";
const TEAL = "#2fbfb3";
const DARK_TEXT = "#2b1d05";

// Positions measured on the layout artwork.
const HERO_AVATAR = { x: 179.5, y: 219.5, r: 41 };
const HERO_NAME_X = 244;
const HERO_MEDAL = { x: 218, y: 261, r: 22 };
const MEDIUM = [
  { avatar: { x: 156, y: 475, r: 32 }, ball: { x: 183, y: 500 }, pill: { x: 264, y: 432, w: 88, h: 31 }, left: 129, right: 356 },
  { avatar: { x: 431, y: 475, r: 32 }, ball: { x: 458, y: 501 }, pill: { x: 539, y: 432, w: 89, h: 31 }, left: 403, right: 632 },
] as const;
const VIEWER_AVATAR = { x: 157, y: 671, r: 30 };

const ROW_X = 763;
const ROW_W = 547;
const ROW_Y0 = 122;
const ROW_PITCH = 88;
const ROW_H = 79;
const ROW_AVATAR_X = 869;
const ROW_COUNT = 7;

export function gold(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, "#f6dc8c");
  gradient.addColorStop(0.55, "#e8bd57");
  gradient.addColorStop(1, "#d3a23f");
  return gradient;
}

/** Draws a picture (or the member's initial) inside a circle, without a ring. */
export function drawAvatar(
  ctx: Ctx2D,
  circle: { x: number; y: number; r: number },
  image: unknown | null,
  initial: string,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (image) {
    ctx.drawImage(image, circle.x - circle.r, circle.y - circle.r, circle.r * 2, circle.r * 2);
  } else {
    ctx.fillStyle = "#1b2a2a";
    ctx.fillRect(circle.x - circle.r, circle.y - circle.r, circle.r * 2, circle.r * 2);
    text(
      ctx,
      initial || "?",
      circle.x,
      circle.y + circle.r * 0.36,
      `${Math.round(circle.r * 0.95)}px ${FONT_BOLD}`,
      GOLD_LIGHT,
      "center",
    );
  }
  ctx.restore();
}

/** Fits text on one line: shrinks the font first, then cuts with an ellipsis. */
function fitted(
  ctx: Ctx2D,
  value: string,
  family: string,
  maxWidth: number,
  size: number,
  minSize: number,
): { value: string; font: string } {
  const finalSize = fitFont(ctx, value, family, maxWidth, size, minSize);
  const font = `${finalSize}px ${family}`;
  ctx.font = font;
  return { value: ellipsize(ctx, value, maxWidth), font };
}

export function drawFitted(
  ctx: Ctx2D,
  value: string,
  x: number,
  y: number,
  family: string,
  maxWidth: number,
  size: number,
  minSize: number,
  fill: string | ReturnType<typeof gold>,
  align: "left" | "center" | "right" = "left",
): void {
  const result = fitted(ctx, value, family, maxWidth, size, minSize);
  text(ctx, result.value, x, y, result.font, fill, align);
}

/** Paints over a placeholder with the same shading as the artwork around it. */
function paintOver(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  stops: Array<[number, string]>,
): void {
  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  const gradient = ctx.createLinearGradient(0, y, 0, y + h);
  for (const [offset, color] of stops) {
    gradient.addColorStop(offset, color);
  }
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}


type DrawImageRegion = (
  image: unknown,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
) => void;

/**
 * Covers a placeholder by stretching a clean sliver of the artwork next to it
 * across it, so the shading (including the vertical fade) matches exactly.
 * Falls back to a flat paint when there is no artwork to copy from.
 */
function coverFromArtwork(
  ctx: Ctx2D,
  background: unknown | null | undefined,
  source: { x: number; w: number },
  target: { x: number; y: number; w: number; h: number },
  fallback: string,
): void {
  if (!background) {
    ctx.save();
    ctx.fillStyle = fallback;
    ctx.fillRect(target.x, target.y, target.w, target.h);
    ctx.restore();
    return;
  }
  (ctx as unknown as { drawImage: DrawImageRegion }).drawImage(
    background,
    source.x, target.y, source.w, target.h,
    target.x, target.y, target.w, target.h,
  );
}

// Row shading measured on the artwork: [offset from the row top, [r, g, b]] on
// the left and right of the sample bar. The row fades from light at the top to
// dark at the bottom, a little lighter toward the right.
const BAR_LEFT: Array<[number, [number, number, number]]> = [
  [17, [53, 53, 45]], [25, [51, 51, 42]], [34, [44, 42, 31]], [42, [39, 38, 27]],
  [50, [36, 35, 26]], [58, [29, 29, 21]], [62, [26, 27, 21]],
];
const BAR_RIGHT: Array<[number, [number, number, number]]> = [
  [17, [57, 58, 51]], [25, [52, 53, 47]], [34, [48, 48, 41]], [42, [41, 42, 35]],
  [50, [34, 35, 29]], [58, [27, 28, 22]], [62, [23, 24, 20]],
];

/** Paints over the little sample bar in a row with the shading around it. */
function coverBar(ctx: Ctx2D, rowTop: number): void {
  const zones: Array<{ x: number; w: number; stops: Array<[number, [number, number, number]]> }> = [
    { x: 904, w: 58, stops: BAR_LEFT },
    {
      x: 962, w: 58,
      stops: BAR_LEFT.map(([offset, left], i) => {
        const right = BAR_RIGHT[i]![1];
        return [offset, [0, 1, 2].map((c) => Math.round((left[c]! + right[c]!) / 2))] as [number, [number, number, number]];
      }),
    },
    { x: 1020, w: 60, stops: BAR_RIGHT },
  ];
  const y = rowTop + 17;
  const h = 45;
  for (const zone of zones) {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, y, 0, y + h);
    for (const [offset, [r, g, b]] of zone.stops) {
      gradient.addColorStop((offset - 17) / h, `rgb(${r},${g},${b})`);
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(zone.x, y, zone.w, h);
    ctx.restore();
  }
}

const BADGE_CENTER_X = 804;

/** Paints over the rank number baked into a row's badge. */
function coverBadgeNumber(ctx: Ctx2D, rowTop: number): void {
  const y = rowTop + ROW_H / 2 - 10;
  ctx.save();
  roundedRect(ctx, BADGE_CENTER_X - 14, y, 28, 20, 8);
  const gradient = ctx.createLinearGradient(0, y, 0, y + 20);
  gradient.addColorStop(0, "#41423a");
  gradient.addColorStop(1, "#2b2a22");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawBadgeRank(ctx: Ctx2D, rowTop: number, rank: number): void {
  const label = `#${rank}`;
  const size = fitFont(ctx, label, FONT_MEDIUM, 26, 16, 10);
  text(ctx, label, BADGE_CENTER_X, rowTop + ROW_H / 2 + size * 0.36, `${size}px ${FONT_MEDIUM}`, "#c9ab68", "center");
}

/**
 * Puts a round badge from the artwork (the medal or a small position ball) back
 * on top of an avatar that was drawn over it, so the badge is never hidden.
 */
export function restoreBadge(
  ctx: Ctx2D,
  background: unknown | null | undefined,
  badge: { x: number; y: number; r: number },
): void {
  if (!background) {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(badge.x, badge.y, badge.r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  (ctx as unknown as { drawImage: DrawImageRegion }).drawImage(
    background,
    badge.x - badge.r, badge.y - badge.r, badge.r * 2, badge.r * 2,
    badge.x - badge.r, badge.y - badge.r, badge.r * 2, badge.r * 2,
  );
  ctx.restore();
}

function drawBadgeNumber(ctx: Ctx2D, center: { x: number; y: number }, label: string): void {
  const size = fitFont(ctx, label, FONT_BOLD, 26, 16, 10);
  text(ctx, label, center.x, center.y + size * 0.36, `${size}px ${FONT_BOLD}`, DARK_TEXT, "center");
}

function drawHero(ctx: Ctx2D, data: LeaderboardCardData, images: LeaderboardCardImages): void {
  const entry = data.slots[0];
  if (!entry) {
    return;
  }
  drawAvatar(ctx, HERO_AVATAR, images.avatars.get(entry.rank) ?? null, entry.initial);

  // Medal on the avatar ring: redrawn above the avatar, then the member's position.
  restoreBadge(ctx, images.background, HERO_MEDAL);
  drawBadgeNumber(ctx, { x: HERO_MEDAL.x, y: HERO_MEDAL.y + 1 }, `#${entry.rank}`);

  // "#1 TOP VOICE" in the empty pill, top right.
  drawFitted(ctx, data.heroPill, 555, 164, FONT_MEDIUM, 120, 15, 10, GOLD_LIGHT, "center");

  drawFitted(ctx, entry.name, HERO_NAME_X, 208, FONT_MEDIUM, 360, 28, 16, "#e8c680");
  if (data.heroCaption) {
    drawFitted(ctx, data.heroCaption, HERO_NAME_X, 234, FONT_REGULAR, 360, 15, 10, MUTED);
  }

  text(ctx, data.heroLabel, 153, 313, `15px ${FONT_REGULAR}`, "#cdb27a");
  drawFitted(ctx, entry.time, 153, 353, FONT_BOLD, 440, 36, 20, gold(ctx, 153, 322, 353, 360));
}

function drawMedium(
  ctx: Ctx2D,
  index: 0 | 1,
  entry: LeaderboardCardEntry | null,
  images: LeaderboardCardImages,
): void {
  const spot = MEDIUM[index];
  if (!entry) {
    return;
  }
  drawAvatar(ctx, spot.avatar, images.avatars.get(entry.rank) ?? null, entry.initial);
  restoreBadge(ctx, images.background, { x: spot.ball.x, y: spot.ball.y + 1, r: 16.5 });
  drawBadgeNumber(ctx, { x: spot.ball.x, y: spot.ball.y + 1 }, String(entry.rank));

  drawFitted(
    ctx, `#${entry.rank} RANK`,
    spot.pill.x + spot.pill.w / 2, spot.pill.y + 21,
    FONT_MEDIUM, spot.pill.w - 16, 14, 9, GOLD_LIGHT, "center",
  );
  const nameLeft = spot.avatar.x + spot.avatar.r + 14;
  drawFitted(ctx, entry.name, nameLeft, 479, FONT_MEDIUM, spot.right - nameLeft - 10, 20, 12, TAN);
  drawFitted(ctx, entry.time, spot.left, 549, FONT_MEDIUM, spot.right - spot.left - 20, 24, 14, TAN);
}

function drawRows(ctx: Ctx2D, data: LeaderboardCardData, images: LeaderboardCardImages): void {
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const top = ROW_Y0 + i * ROW_PITCH;
    const centerY = top + ROW_H / 2;

    // Cover the sample bar and the empty pill that are part of the artwork,
    // and the baked-in rank number, which is redrawn so later pages are correct.
    coverBar(ctx, top);
    coverFromArtwork(ctx, images.background, { x: 1126, w: 3 }, { x: 1132, y: top + 15, w: 166, h: ROW_H - 30 }, "#060804");
    coverBadgeNumber(ctx, top);

    // An unused slot on a short page stays empty.
    const entry = data.slots[3 + i];
    if (!entry) {
      continue;
    }
    drawBadgeRank(ctx, top, entry.rank);
    drawAvatar(
      ctx,
      { x: ROW_AVATAR_X, y: centerY, r: 25 },
      images.avatars.get(entry.rank) ?? null,
      entry.initial,
    );
    drawFitted(ctx, entry.name, 909, centerY + 7, FONT_MEDIUM, 330, 20, 12, TAN);
    drawFitted(ctx, entry.time, 1288, centerY + 8, FONT_MEDIUM, 160, 22, 13, TAN, "right");
  }
}

function drawViewer(ctx: Ctx2D, data: LeaderboardCardData, images: LeaderboardCardImages): void {
  const viewer = data.viewer;
  if (!viewer) {
    return;
  }
  drawAvatar(ctx, VIEWER_AVATAR, images.viewerAvatar, viewer.initial);
  text(ctx, "YOUR CURRENT STANDING", 203, 655, `13px ${FONT_REGULAR}`, "#cdb27a");
  drawFitted(ctx, viewer.rankText, 203, 684, FONT_MEDIUM, 270, 26, 16, WHITE);
  if (viewer.handle) {
    drawFitted(ctx, viewer.handle, 203, 713, FONT_REGULAR, 270, 14, 10, MUTED);
  }
  drawFitted(ctx, viewer.time, 618, 679, FONT_MEDIUM, 150, 24, 14, TEAL, "right");
}

export function drawLeaderboardCard(
  ctx: Ctx2D,
  data: LeaderboardCardData,
  images: LeaderboardCardImages,
): void {
  const W = LEADERBOARD_CARD_WIDTH;
  const H = LEADERBOARD_CARD_HEIGHT;

  if (images.background) {
    ctx.drawImage(images.background, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
  }

  // Header: subtitle under the title, and the page label in the pill.
  drawFitted(ctx, data.subtitle, 109, 101, FONT_MEDIUM, 540, 15, 10, "#bfa979");
  paintOver(ctx, 1182, 55, 114, 26, 10, [
    [0, "#363228"],
    [0.5, "#26231a"],
    [1, "#1e1b14"],
  ]);
  text(ctx, data.pageLabel, 1239, 74, `17px ${FONT_MEDIUM}`, GOLD_LIGHT, "center");

  drawHero(ctx, data, images);
  drawMedium(ctx, 0, data.slots[1] ?? null, images);
  drawMedium(ctx, 1, data.slots[2] ?? null, images);
  drawViewer(ctx, data, images);
  drawRows(ctx, data, images);
}
