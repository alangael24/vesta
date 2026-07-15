import { decode, encode } from "fast-png";

export type ChromaStats = {
  width: number;
  height: number;
  transparentPixelRatio: number;
  foregroundPixelRatio: number;
  edgePixelRatio: number;
};

export function removeChroma(input: Uint8Array, target: [number, number, number]) {
  const decoded = decode(input, { checkCrc: true });
  if (decoded.depth !== 8 || decoded.channels < 3) throw new ChromaError("unsupported_png", "Reconstruction PNG must be 8-bit RGB or RGBA.");
  const rgba = new Uint8Array(decoded.width * decoded.height * 4);
  let transparent = 0;
  let foreground = 0;
  let edge = 0;
  const pixels = decoded.width * decoded.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const source = pixel * decoded.channels;
    const destination = pixel * 4;
    const red = Number(decoded.data[source]);
    const green = Number(decoded.data[source + 1]);
    const blue = Number(decoded.data[source + 2]);
    const originalAlpha = decoded.channels === 4 ? Number(decoded.data[source + 3]) : 255;
    const distance = Math.sqrt((red - target[0]) ** 2 + (green - target[1]) ** 2 + (blue - target[2]) ** 2);
    const opacity = smoothstep(34, 132, distance);
    const alpha = Math.round(originalAlpha * opacity);
    rgba[destination] = red;
    rgba[destination + 1] = green;
    rgba[destination + 2] = blue;
    rgba[destination + 3] = alpha;
    if (alpha < 16) transparent += 1;
    else if (alpha > 239) foreground += 1;
    else edge += 1;
  }
  const png = encode({ width: decoded.width, height: decoded.height, data: rgba, channels: 4, depth: 8 });
  return {
    png,
    stats: {
      width: decoded.width,
      height: decoded.height,
      transparentPixelRatio: Math.round((transparent / pixels) * 100),
      foregroundPixelRatio: Math.round((foreground / pixels) * 100),
      edgePixelRatio: Math.round((edge / pixels) * 100),
    } satisfies ChromaStats,
  };
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

export class ChromaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
