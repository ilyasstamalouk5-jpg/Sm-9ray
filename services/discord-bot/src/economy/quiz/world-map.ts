// Reads the world map (TopoJSON from the `world-atlas` package) and works out
// which outline to draw for a country. No drawing happens here, so it can be
// tested without a canvas.

type Position = [number, number];

export type Topology = {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: {
    countries: {
      geometries: Array<{
        id?: string | number;
        type: string;
        arcs?: unknown;
      }>;
    };
  };
};

/** A polygon: its outer ring first, then any holes. Points are [lon, lat]. */
export type Polygon = Position[][];

export type CountryShape = { numeric: number; polygons: Polygon[] };

function decodeArcs(topology: Topology): Position[][] {
  const [scaleX, scaleY] = topology.transform?.scale ?? [1, 1];
  const [translateX, translateY] = topology.transform?.translate ?? [0, 0];
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map((point) => {
      // With a transform, points are stored as steps from the previous one.
      if (topology.transform) {
        x += point[0] as number;
        y += point[1] as number;
        return [x * scaleX + translateX, y * scaleY + translateY] as Position;
      }
      return [point[0], point[1]] as Position;
    });
  });
}

function buildRing(arcIndexes: number[], arcs: Position[][]): Position[] {
  const ring: Position[] = [];
  for (const index of arcIndexes) {
    const arc = index >= 0 ? arcs[index] : arcs[~index]?.slice().reverse();
    if (!arc) {
      continue;
    }
    // Each arc starts where the previous one ended, so skip the repeated point.
    ring.push(...(ring.length > 0 ? arc.slice(1) : arc));
  }
  return ring;
}

export function readCountryShapes(topology: Topology): Map<number, CountryShape> {
  const arcs = decodeArcs(topology);
  const shapes = new Map<number, CountryShape>();
  for (const geometry of topology.objects.countries.geometries) {
    const numeric = Number(geometry.id);
    if (!Number.isInteger(numeric) || geometry.arcs === undefined) {
      continue;
    }
    let polygons: Polygon[] = [];
    if (geometry.type === "Polygon") {
      polygons = [(geometry.arcs as number[][]).map((ring) => buildRing(ring, arcs))];
    } else if (geometry.type === "MultiPolygon") {
      polygons = (geometry.arcs as number[][][]).map((polygon) =>
        polygon.map((ring) => buildRing(ring, arcs)),
      );
    }
    if (polygons.length > 0) {
      shapes.set(numeric, { numeric, polygons });
    }
  }
  return shapes;
}

function ringArea(ring: Position[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index] as Position;
    const [x2, y2] = ring[(index + 1) % ring.length] as Position;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export type View = {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
};

/**
 * The area to show for a country. Far-away pieces (French Guiana for France,
 * Hawaii for the USA) are ignored so the main part of the country fills the
 * picture; they are simply cut off if they fall outside.
 */
export function viewForCountry(shape: CountryShape, minShare = 0.25): View {
  const areas = shape.polygons.map((polygon) => ringArea(polygon[0] ?? []));
  const largest = Math.max(...areas);
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  shape.polygons.forEach((polygon, index) => {
    if ((areas[index] as number) < largest * minShare) {
      return;
    }
    for (const [lon, lat] of polygon[0] ?? []) {
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  });
  return { minLon, maxLon, minLat, maxLat };
}

export type Projection = (lon: number, lat: number) => [number, number];

/** Fits `view` into a width x height picture with some empty margin around it. */
export function fitProjection(
  view: View,
  width: number,
  height: number,
  margin = 0.14,
): Projection {
  const midLat = (view.minLat + view.maxLat) / 2;
  const stretch = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  const spanX = Math.max(0.5, (view.maxLon - view.minLon) * stretch);
  const spanY = Math.max(0.5, view.maxLat - view.minLat);
  const scale = Math.min((width * (1 - 2 * margin)) / spanX, (height * (1 - 2 * margin)) / spanY);
  const centerLon = (view.minLon + view.maxLon) / 2;
  return (lon, lat) => [
    width / 2 + (lon - centerLon) * stretch * scale,
    height / 2 - (lat - midLat) * scale,
  ];
}
