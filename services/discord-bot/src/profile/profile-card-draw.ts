// Draws the /profile card on top of the background artwork
// (assets/profile-card-bg.jpg). The artwork already contains the frame, the
// avatar circle, the rank panel with its labels and the three stat boxes with
// their labels, so this only places text, the avatar, the progress bar and the
// coin inside those shapes. Uses only standard 2D canvas calls.

import {
  GOLD,
  GOLD_DARK,
  GOLD_LIGHT,
  GRAY,
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  WHITE,
  ellipsize,
  fitFont,
  goldGradient,
  roundedRect,
  text,
  type Ctx2D,
} from "../milestones/milestone-card-draw.js";
import type { ProfileCardData } from "./profile-card-data.js";

export const PROFILE_CARD_WIDTH = 1347;
export const PROFILE_CARD_HEIGHT = 784;

export type ProfileCardImages = {
  background?: unknown | null;
  /** The member's avatar, or null for a placeholder letter. */
  avatar: unknown | null;
  /** The currency coin (optional). */
  coin: unknown | null;
};

const SOFT_WHITE = "#ece6d6";
const MUTED = "#a8a396";

// Positions measured on the background artwork.
const AVATAR = { x: 168, y: 152, r: 76 };
const BAR = { x: 595, y: 365, w: 658, h: 27 };
const BOXES = [
  { x: 74, w: 387 },
  { x: 483, w: 387 },
  { x: 891, w: 392 },
] as const;

/** Bright gold for text; the shared goldGradient fades to dark brown. */
function textGold(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number) {
  const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, "#f6dc8c");
  gradient.addColorStop(0.55, "#e8bd57");
  gradient.addColorStop(1, "#d3a23f");
  return gradient;
}

function drawBar(ctx: Ctx2D, fraction: number): void {
  // Cover the example bar that is part of the artwork, then draw the real one.
  ctx.save();
  roundedRect(ctx, BAR.x - 3, BAR.y - 3, BAR.w + 6, BAR.h + 6, (BAR.h + 6) / 2);
  ctx.fillStyle = "#040404";
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundedRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, BAR.h / 2);
  ctx.fillStyle = "#000000";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(217,180,90,0.25)";
  ctx.stroke();
  ctx.restore();

  if (fraction <= 0) {
    return;
  }
  const fillWidth = Math.max(BAR.h, BAR.w * fraction);
  ctx.save();
  roundedRect(ctx, BAR.x, BAR.y, fillWidth, BAR.h, BAR.h / 2);
  ctx.clip();
  const gradient = ctx.createLinearGradient(BAR.x, 0, BAR.x + fillWidth, 0);
  gradient.addColorStop(0, "#000000");
  gradient.addColorStop(0.5, "#d9a93a");
  gradient.addColorStop(0.82, "#f6d56a");
  gradient.addColorStop(1, "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(BAR.x, BAR.y, fillWidth, BAR.h);
  ctx.restore();
}

export function drawProfileCard(
  ctx: Ctx2D,
  data: ProfileCardData,
  images: ProfileCardImages,
): void {
  const W = PROFILE_CARD_WIDTH;
  const H = PROFILE_CARD_HEIGHT;

  if (images.background) {
    ctx.drawImage(images.background, 0, 0, W, H);
  } else {
    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, W, H);
  }

  // Avatar inside the circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR.x, AVATAR.y, AVATAR.r - 1, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (images.avatar) {
    ctx.drawImage(
      images.avatar,
      AVATAR.x - AVATAR.r,
      AVATAR.y - AVATAR.r,
      AVATAR.r * 2,
      AVATAR.r * 2,
    );
  } else {
    ctx.fillStyle = "#1b2a2a";
    ctx.fillRect(AVATAR.x - AVATAR.r, AVATAR.y - AVATAR.r, AVATAR.r * 2, AVATAR.r * 2);
    const initial = (data.handle.replace("@", "").charAt(0) || "?").toUpperCase();
    text(ctx, initial, AVATAR.x, AVATAR.y + 24, `68px ${FONT_BOLD}`, GOLD_LIGHT, "center");
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(AVATAR.x, AVATAR.y, AVATAR.r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = goldGradient(
    ctx,
    AVATAR.x - AVATAR.r,
    AVATAR.y - AVATAR.r,
    AVATAR.x + AVATAR.r,
    AVATAR.y + AVATAR.r,
  );
  ctx.stroke();
  ctx.restore();

  // Name: first word white, the rest gold
  const nameMax = 395;
  const fullName = data.nameWords.join(" ");
  const nameSize = fitFont(ctx, fullName, FONT_BOLD, nameMax, 46, 22);
  const nameFont = `${nameSize}px ${FONT_BOLD}`;
  ctx.font = nameFont;
  const shownName = ellipsize(ctx, fullName, nameMax);
  const [first = "", ...restWords] = shownName.split(" ");
  const rest = restWords.join(" ");
  text(ctx, first, 285, 138, nameFont, WHITE);
  if (rest) {
    ctx.font = nameFont;
    const firstWidth = ctx.measureText(`${first} `).width;
    text(ctx, rest, 285 + firstWidth, 138, nameFont, textGold(ctx, 285, 100, 705, 140));
  }

  // Handle
  const handleSize = fitFont(ctx, data.handle, FONT_REGULAR, nameMax, 24, 14);
  ctx.font = `${handleSize}px ${FONT_REGULAR}`;
  text(
    ctx,
    ellipsize(ctx, data.handle, nameMax),
    285, 172, `${handleSize}px ${FONT_REGULAR}`, GRAY,
  );

  // Pill under the handle
  const pillSize = fitFont(ctx, data.pillText, FONT_MEDIUM, 440, 17, 11);
  ctx.font = `${pillSize}px ${FONT_MEDIUM}`;
  const pillText = ellipsize(ctx, data.pillText, 440);
  const pillWidth = ctx.measureText(pillText).width + 36;
  ctx.save();
  roundedRect(ctx, 284, 184, pillWidth, 30, 15);
  ctx.fillStyle = "rgba(217,180,90,0.14)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = GOLD_DARK;
  ctx.stroke();
  ctx.restore();
  text(ctx, pillText, 284 + pillWidth / 2, 205, `${pillSize}px ${FONT_MEDIUM}`, GOLD_LIGHT, "center");

  // Leaderboard position, top right (above/below the line in the artwork)
  const rankValueSize = fitFont(ctx, data.rankValue, FONT_BOLD, 300, 46, 24);
  text(
    ctx,
    data.rankValue,
    1222, 118, `${rankValueSize}px ${FONT_BOLD}`,
    textGold(ctx, 1000, 80, 1222, 120),
    "right",
  );
  text(ctx, "SERVER VOICE POSITION", 1222, 166, `16px ${FONT_MEDIUM}`, MUTED, "right");

  // Rank panel
  text(ctx, data.rankLabel, 107, 308, `21px ${FONT_REGULAR}`, SOFT_WHITE);
  const titleMax = 470;
  const titleSize = fitFont(ctx, data.rankTitle, FONT_BOLD, titleMax, 46, 24);
  ctx.font = `${titleSize}px ${FONT_BOLD}`;
  ctx.save();
  ctx.shadowColor = "rgba(217,180,90,0.35)";
  ctx.shadowBlur = 10;
  text(
    ctx,
    ellipsize(ctx, data.rankTitle, titleMax),
    107, 354, `${titleSize}px ${FONT_BOLD}`,
    textGold(ctx, 107, 318, 107 + titleMax, 358),
  );
  ctx.restore();
  const subSize = fitFont(ctx, data.rankSub, FONT_MEDIUM, titleMax + 30, 23, 13);
  text(ctx, data.rankSub, 107, 388, `${subSize}px ${FONT_MEDIUM}`, GOLD);

  // "NEXT GOAL: <name>", right-aligned above the bar
  const goalMax = 650;
  let goalSize = 22;
  const goalWidth = (size: number): number => {
    ctx.font = `${size}px ${FONT_REGULAR}`;
    const prefixWidth = data.nextPrefix ? ctx.measureText(data.nextPrefix).width : 0;
    ctx.font = `${size}px ${FONT_BOLD}`;
    return prefixWidth + ctx.measureText(data.nextTitle).width;
  };
  while (goalSize > 13 && goalWidth(goalSize) > goalMax) {
    goalSize -= 1;
  }
  const totalGoalWidth = goalWidth(goalSize);
  const goalLeft = 1252 - totalGoalWidth;
  ctx.font = `${goalSize}px ${FONT_REGULAR}`;
  const prefixWidth = data.nextPrefix ? ctx.measureText(data.nextPrefix).width : 0;
  if (data.nextPrefix) {
    text(ctx, data.nextPrefix, goalLeft, 347, `${goalSize}px ${FONT_REGULAR}`, WHITE);
  }
  text(ctx, data.nextTitle, goalLeft + prefixWidth, 347, `${goalSize}px ${FONT_BOLD}`, GOLD_LIGHT);

  drawBar(ctx, data.progressFraction);
  text(ctx, data.progressNote, BAR.x + 8, 424, `19px ${FONT_MEDIUM}`, SOFT_WHITE);

  // Stat boxes (labels are part of the artwork)
  const values: Array<{ value: string; sub: string }> = [
    { value: data.totalValue, sub: data.totalSub },
    { value: data.weekValue, sub: data.weekSub },
    { value: data.walletValue, sub: data.walletSub },
  ];
  values.forEach((entry, index) => {
    const box = BOXES[index]!;
    const coinSpace = index === 2 && data.hasWallet && images.coin ? 74 : 0;
    const maxWidth = box.w - 52 - coinSpace;
    const size = fitFont(ctx, entry.value, FONT_BOLD, maxWidth, 36, 20);
    ctx.font = `${size}px ${FONT_BOLD}`;
    text(
      ctx,
      ellipsize(ctx, entry.value, maxWidth),
      box.x + 26, 588, `${size}px ${FONT_BOLD}`,
      textGold(ctx, box.x + 26, 556, box.x + 26 + 160, 592),
    );
    const subSize = fitFont(ctx, entry.sub, FONT_REGULAR, box.w - 52, 17, 11);
    text(ctx, entry.sub, box.x + 26, 630, `${subSize}px ${FONT_REGULAR}`, MUTED);
  });
  if (data.hasWallet && images.coin) {
    const box = BOXES[2];
    ctx.save();
    ctx.shadowColor = "rgba(243,218,143,0.5)";
    ctx.shadowBlur = 14;
    ctx.drawImage(images.coin, box.x + box.w - 26 - 58, 548, 58, 58);
    ctx.restore();
  }

  // Footer
  const footerSize = fitFont(ctx, data.footer, FONT_REGULAR, 800, 17, 11);
  ctx.font = `${footerSize}px ${FONT_REGULAR}`;
  text(
    ctx,
    ellipsize(ctx, data.footer, 800),
    W / 2, 731, `${footerSize}px ${FONT_REGULAR}`, "rgba(185,180,168,0.8)", "center",
  );
}
