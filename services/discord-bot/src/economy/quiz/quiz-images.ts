// Draws the pictures for the map and logo games with @napi-rs/canvas, the same
// package the other cards use.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadCanvas } from "../../milestones/milestone-card.js";
import { BRANDS, type Brand } from "./quiz-data.js";
import {
  fitProjection,
  readCountryShapes,
  viewForCountry,
  type CountryShape,
  type Topology,
} from "./world-map.js";

const WIDTH = 800;
const HEIGHT = 500;
const require = createRequire(import.meta.url);

// ------------------------------------------------------------------- maps

let shapesPromise: Promise<Map<number, CountryShape>> | null = null;

function loadShapes(): Promise<Map<number, CountryShape>> {
  shapesPromise ??= readFile(require.resolve("world-atlas/countries-110m.json"), "utf8").then(
    (text) => readCountryShapes(JSON.parse(text) as Topology),
  );
  return shapesPromise;
}

/** The numeric codes of the countries that exist on the installed world map. */
export async function availableMapCodes(): Promise<Set<number>> {
  return new Set((await loadShapes()).keys());
}

export async function renderMapImage(numeric: number): Promise<Buffer> {
  const [canvasModule, shapes] = await Promise.all([loadCanvas(), loadShapes()]);
  const target = shapes.get(numeric);
  if (!target) {
    throw new Error(`Country ${numeric} is not on the world map.`);
  }
  const canvas = canvasModule.createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  const project = fitProjection(viewForCountry(target), WIDTH, HEIGHT);

  ctx.fillStyle = "#14202e";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const drawShape = (shape: CountryShape, fill: string, stroke: string, lineWidth: number) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    for (const polygon of shape.polygons) {
      ctx.beginPath();
      for (const ring of polygon) {
        ring.forEach(([lon, lat], index) => {
          const [x, y] = project(lon, lat);
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.closePath();
      }
      ctx.fill("evenodd");
      ctx.stroke();
    }
  };

  // Neighbours first, in grey, so the shape of the borders is visible.
  for (const shape of shapes.values()) {
    if (shape.numeric !== numeric) {
      drawShape(shape, "#34404f", "#14202e", 1.5);
    }
  }
  drawShape(target, "#f1c40f", "#fff3b0", 2);
  return canvas.toBuffer("image/png");
}

// ------------------------------------------------------------------ logos

type SimpleIcon = { title: string; hex: string; path: string };
let iconsPromise: Promise<Record<string, SimpleIcon | undefined>> | null = null;

function loadIcons(): Promise<Record<string, SimpleIcon | undefined>> {
  iconsPromise ??= import("simple-icons").then(
    (module) => module as unknown as Record<string, SimpleIcon | undefined>,
  );
  return iconsPromise;
}

/** The brands whose icon exists in the installed `simple-icons` version. */
export async function availableBrands(): Promise<Brand[]> {
  const icons = await loadIcons();
  return BRANDS.filter((brand) => typeof icons[brand.icon]?.path === "string");
}

function isLight(hex: string): boolean {
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return 0.299 * red + 0.587 * green + 0.114 * blue > 190;
}

export async function renderLogoImage(iconKey: string): Promise<Buffer> {
  const [canvasModule, icons] = await Promise.all([loadCanvas(), loadIcons()]);
  const icon = icons[iconKey];
  if (!icon) {
    throw new Error(`The icon ${iconKey} is not available.`);
  }
  const canvas = canvasModule.createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  // Very light logos sit on a dark card, everything else on a light one.
  ctx.fillStyle = isLight(icon.hex) ? "#1c1f26" : "#f4f4f6";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const size = 300;
  ctx.save();
  ctx.translate((WIDTH - size) / 2, (HEIGHT - size) / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = `#${icon.hex}`;
  ctx.fill(new canvasModule.Path2D(icon.path));
  ctx.restore();
  return canvas.toBuffer("image/png");
}
