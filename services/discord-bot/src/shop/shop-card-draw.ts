// Draws the /shop card: a gold-and-black picture of the colors on one page.
// Everything is drawn with standard 2D canvas calls (no artwork file), so the
// same code works with @napi-rs/canvas in the bot and in tests.

import {
  FONT_BOLD,
  FONT_MEDIUM,
  FONT_REGULAR,
  GOLD,
  GOLD_LIGHT,
  ellipsize,
  fitFont,
  goldGradient,
  roundedRect,
  text,
  type Ctx2D,
} from "../milestones/milestone-card-draw.js";
import { SHOP_ITEMS_PER_PAGE, type ShopCardData, type ShopCardTile } from "./shop-card-data.js";

export const SHOP_CARD_WIDTH = 1376;
export const SHOP_CARD_HEIGHT = 768;

const TAN = "#e6cc94";
const SUBTITLE = "#bfa979";
const MUTED = "#a8a396";
const DIM_GOLD = "#6f6650";
const NAME_DEFAULT = "#efe7d2";
const BORDER = "#4a3b17";

const COLUMNS = 3;
const GRID_X = 80;
const GRID_Y = 186;
const GRID_W = SHOP_CARD_WIDTH - 2 * GRID_X;
const GRID_BOTTOM = 640;
const GAP = 22;
const ROWS = Math.ceil(SHOP_ITEMS_PER_PAGE / COLUMNS);
const TILE_W = (GRID_W - GAP * (COLUMNS - 1)) / COLUMNS;
const TILE_H = (GRID_BOTTOM - GRID_Y - GAP * (ROWS - 1)) / ROWS;

/** Black or white, whichever is easier to read on top of this role color. */
export function readableOn(color: number): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111111" : "#ffffff";
}

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
}

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

function drawTile(ctx: Ctx2D, tile: ShopCardTile, x: number, y: number): void {
  const w = TILE_W;
  const h = TILE_H;
  const worn = tile.state === "worn";

  // Panel.
  const panel = ctx.createLinearGradient(x, y, x, y + h);
  panel.addColorStop(0, "#18150c");
  panel.addColorStop(1, "#0c0c0b");
  roundedRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = panel;
  ctx.fill();
  roundedRect(ctx, x, y, w, h, 20);
  ctx.strokeStyle = worn ? goldGradient(ctx, x, y, x + w, y + h) : BORDER;
  ctx.lineWidth = worn ? 3 : 1.5;
  ctx.stroke();

  // Number badge (matches the number in the menu below the card).
  ctx.beginPath();
  ctx.arc(x + 38, y + 42, 18, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "#1f1a0d";
  ctx.fill();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, String(tile.number), x + 38, y + 48, `18px ${FONT_BOLD}`, GOLD_LIGHT, "center");

  // Name (drawn in the role color) and the short description.
  const textLeft = x + 70;
  const textWidth = w - 70 - 24;
  fitted(ctx, tile.name, textLeft, y + 46, FONT_BOLD, textWidth, 26, 14, tile.color === null ? NAME_DEFAULT : hex(tile.color));
  if (tile.description) {
    fitted(ctx, tile.description, textLeft, y + 74, FONT_REGULAR, textWidth, 16, 11, MUTED);
  }

  // Color band: the exact role color, with a sample line on top.
  const bandX = x + 24;
  const bandY = y + 98;
  const bandW = w - 48;
  const bandH = 44;
  roundedRect(ctx, bandX, bandY, bandW, bandH, 22);
  ctx.fillStyle = tile.color === null ? "#2a2a28" : hex(tile.color);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = 0.25;
  roundedRect(ctx, bandX, bandY, bandW, bandH, 22);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  text(
    ctx,
    tile.color === null ? "No color set" : tile.colorHex,
    bandX + bandW / 2,
    bandY + bandH / 2 + 6,
    `17px ${FONT_MEDIUM}`,
    tile.color === null ? MUTED : readableOn(tile.color),
    "center",
  );

  // Price (dimmed when the viewer cannot pay yet) and the ownership badge.
  const badgeW = 118;
  const baseline = y + h - 30;
  const priceFill = tile.affordable ? goldGradient(ctx, x + 26, baseline - 24, x + 26, baseline) : DIM_GOLD;
  fitted(ctx, tile.priceText, x + 26, baseline, FONT_BOLD, w - 52 - badgeW - 12, 30, 16, priceFill);

  if (tile.badge) {
    const badgeX = x + w - 24 - badgeW;
    const badgeY = y + h - 24 - 34;
    roundedRect(ctx, badgeX, badgeY, badgeW, 34, 17);
    if (worn) {
      ctx.fillStyle = goldGradient(ctx, badgeX, badgeY, badgeX + badgeW, badgeY + 34);
      ctx.fill();
    } else {
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    text(ctx, tile.badge, badgeX + badgeW / 2, badgeY + 23, `15px ${FONT_BOLD}`, worn ? "#111111" : GOLD_LIGHT, "center");
  }
}

export function drawShopCard(ctx: Ctx2D, data: ShopCardData): void {
  const W = SHOP_CARD_WIDTH;
  const H = SHOP_CARD_HEIGHT;

  // Black background with a soft gold glow at the top.
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, 700);
  glow.addColorStop(0, "rgba(217,180,90,0.16)");
  glow.addColorStop(1, "rgba(217,180,90,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Double gold frame.
  roundedRect(ctx, 22, 22, W - 44, H - 44, 30);
  ctx.strokeStyle = goldGradient(ctx, 22, 22, W - 22, H - 22);
  ctx.lineWidth = 3;
  ctx.stroke();
  roundedRect(ctx, 36, 36, W - 72, H - 72, 22);
  ctx.strokeStyle = "#3b2f12";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header: title, server line and the page pill.
  text(ctx, data.title, GRID_X, 112, `46px ${FONT_BOLD}`, goldGradient(ctx, GRID_X, 70, GRID_X + 380, 112));
  fitted(ctx, data.subtitle, GRID_X + 2, 146, FONT_MEDIUM, 560, 16, 10, SUBTITLE);
  roundedRect(ctx, W - GRID_X - 190, 70, 190, 44, 22);
  ctx.strokeStyle = goldGradient(ctx, W - GRID_X - 190, 70, W - GRID_X, 114);
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, data.pageLabel, W - GRID_X - 95, 99, `17px ${FONT_MEDIUM}`, TAN, "center");

  if (data.empty) {
    text(ctx, data.emptyTitle, W / 2, 380, `44px ${FONT_BOLD}`, goldGradient(ctx, W / 2 - 200, 340, W / 2 + 200, 380), "center");
    text(ctx, data.emptyText, W / 2, 430, `20px ${FONT_MEDIUM}`, MUTED, "center");
  } else {
    data.tiles.forEach((tile, index) => {
      if (!tile) {
        return;
      }
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      drawTile(ctx, tile, GRID_X + column * (TILE_W + GAP), GRID_Y + row * (TILE_H + GAP));
    });
  }

  // Footer: who is looking, a hint, and their balance.
  roundedRect(ctx, GRID_X, 662, GRID_W, 58, 18);
  ctx.fillStyle = "#0e0c07";
  ctx.fill();
  roundedRect(ctx, GRID_X, 662, GRID_W, 58, 18);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  fitted(ctx, data.viewerName, GRID_X + 28, 698, FONT_MEDIUM, 330, 20, 12, TAN);
  fitted(ctx, data.hint, W / 2, 697, FONT_REGULAR, 420, 16, 11, MUTED, "center");
  text(ctx, "BALANCE", W - GRID_X - 28, 680, `12px ${FONT_MEDIUM}`, SUBTITLE, "right");
  fitted(ctx, data.balanceText, W - GRID_X - 28, 709, FONT_BOLD, 300, 24, 14, goldGradient(ctx, W - 400, 685, W - 108, 709), "right");
}
