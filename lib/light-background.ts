import { decode as decodeJpeg } from "jpeg-js";
import { decode as decodePng, encode as encodePng } from "fast-png";

export type LightBackgroundStats = {
  width: number;
  height: number;
  transparentPixelRatio: number;
  foregroundPixelRatio: number;
  edgePixelRatio: number;
};

export type LightBackgroundResult = {
  png: Uint8Array;
  applied: boolean;
  hadTransparency: boolean;
  background: [number, number, number] | null;
  stats: LightBackgroundStats;
};

const maximumPixels = 24_000_000;
const lightBackgroundTraversalDistance = 30;
const lightBackgroundFeatherStart = 6;

/**
 * Removes only a light, low-saturation background connected to the image edge.
 * White details enclosed by the garment are deliberately left untouched.
 */
export function removeLightBackground(input: Uint8Array, contentType: string): LightBackgroundResult | null {
  const decoded = decodeRaster(input, contentType);
  if (!decoded) return null;
  const { width, height, rgba } = decoded;
  const originalRgba = rgba.slice();
  const pixels = width * height;
  const initialTransparent = countTransparent(rgba);
  const hadTransparency = initialTransparent / pixels >= 0.01;
  const background = estimateLightEdgeColor(rgba, width, height);

  if (background) floodLightBackground(rgba, width, height, background);

  const stats = measure(rgba, width, height);
  const newlyTransparent = stats.transparentPixelRatio - Math.round((initialTransparent / pixels) * 100);
  const applied = Boolean(background)
    && newlyTransparent >= 4
    && stats.transparentPixelRatio >= 8
    && stats.transparentPixelRatio <= 95
    && stats.foregroundPixelRatio >= 3;

  // A failed safety check must not leave a partially erased garment.
  if (!applied) {
    return {
      png: encodePng({ width, height, data: originalRgba, channels: 4, depth: 8 }),
      applied: false,
      hadTransparency,
      background,
      stats: measure(originalRgba, width, height),
    };
  }

  return {
    png: encodePng({ width, height, data: rgba, channels: 4, depth: 8 }),
    applied,
    hadTransparency,
    background,
    stats,
  };
}

function decodeRaster(input: Uint8Array, contentType: string) {
  const type = contentType.split(";", 1)[0].trim().toLowerCase();
  if (type === "image/jpeg" || isJpeg(input)) {
    const image = decodeJpeg(input, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: true,
      maxResolutionInMP: 24,
      maxMemoryUsageInMB: 128,
    });
    validateDimensions(image.width, image.height);
    return { width: image.width, height: image.height, rgba: new Uint8Array(image.data) };
  }
  if (type !== "image/png" && !isPng(input)) return null;
  validatePngHeader(input);
  const image = decodePng(input, { checkCrc: true });
  validateDimensions(image.width, image.height);
  const rgba = new Uint8Array(image.width * image.height * 4);
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const source = pixel * image.channels;
    const destination = pixel * 4;
    if (image.channels === 1 || image.channels === 2) {
      rgba[destination] = Number(image.data[source]);
      rgba[destination + 1] = Number(image.data[source]);
      rgba[destination + 2] = Number(image.data[source]);
      rgba[destination + 3] = image.channels === 2 ? Number(image.data[source + 1]) : 255;
    } else {
      rgba[destination] = Number(image.data[source]);
      rgba[destination + 1] = Number(image.data[source + 1]);
      rgba[destination + 2] = Number(image.data[source + 2]);
      rgba[destination + 3] = image.channels === 4 ? Number(image.data[source + 3]) : 255;
    }
  }
  return { width: image.width, height: image.height, rgba };
}

function estimateLightEdgeColor(rgba: Uint8Array, width: number, height: number): [number, number, number] | null {
  const samples: Array<[number, number, number]> = [];
  let opaqueEdgePixels = 0;
  const sample = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if (rgba[offset + 3] < 32) return;
    opaqueEdgePixels += 1;
    const red = rgba[offset];
    const green = rgba[offset + 1];
    const blue = rgba[offset + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
    if (luminance >= 224 && maximum - minimum <= 52) samples.push([red, green, blue]);
  };
  for (let x = 0; x < width; x += 1) {
    sample(x, 0);
    if (height > 1) sample(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    sample(0, y);
    if (width > 1) sample(width - 1, y);
  }
  if (samples.length < Math.max(8, opaqueEdgePixels * 0.42)) return null;
  const channel = (index: number) => median(samples.map((value) => value[index]));
  return [channel(0), channel(1), channel(2)];
}

function floodLightBackground(rgba: Uint8Array, width: number, height: number, background: [number, number, number]) {
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;
  const enqueue = (pixel: number) => {
    if (visited[pixel] || !isLightBackgroundPixel(rgba, pixel, background)) return;
    visited[pixel] = 1;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(pixel - 1);
    if (x + 1 < width) enqueue(pixel + 1);
    if (y > 0) enqueue(pixel - width);
    if (y + 1 < height) enqueue(pixel + width);
  }

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if (!visited[pixel]) continue;
    const offset = pixel * 4;
    const originalAlpha = rgba[offset + 3];
    const distance = colorDistance(rgba[offset], rgba[offset + 1], rgba[offset + 2], background);
    const opacity = smoothstep(lightBackgroundFeatherStart, lightBackgroundTraversalDistance, distance);
    const alpha = Math.round(originalAlpha * opacity);
    if (alpha > 0 && alpha < originalAlpha) {
      const normalized = alpha / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        rgba[offset + channel] = clampByte((rgba[offset + channel] - (1 - normalized) * background[channel]) / normalized);
      }
    }
    rgba[offset + 3] = alpha;
  }
}

function isLightBackgroundPixel(rgba: Uint8Array, pixel: number, background: [number, number, number]) {
  const offset = pixel * 4;
  if (rgba[offset + 3] < 32) return true;
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  return luminance >= 174
    && chroma <= 86
    && colorDistance(red, green, blue, background) <= lightBackgroundTraversalDistance;
}

function colorDistance(red: number, green: number, blue: number, target: [number, number, number]) {
  return Math.sqrt((red - target[0]) ** 2 + (green - target[1]) ** 2 + (blue - target[2]) ** 2);
}

function measure(rgba: Uint8Array, width: number, height: number): LightBackgroundStats {
  let transparent = 0;
  let foreground = 0;
  let edge = 0;
  const pixels = width * height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const alpha = rgba[pixel * 4 + 3];
    if (alpha < 16) transparent += 1;
    else if (alpha > 239) foreground += 1;
    else edge += 1;
  }
  return {
    width,
    height,
    transparentPixelRatio: Math.round((transparent / pixels) * 100),
    foregroundPixelRatio: Math.round((foreground / pixels) * 100),
    edgePixelRatio: Math.round((edge / pixels) * 100),
  };
}

function countTransparent(rgba: Uint8Array) {
  let count = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) if (rgba[offset] < 16) count += 1;
  return count;
}

function validatePngHeader(input: Uint8Array) {
  if (input.length < 24 || !isPng(input)) throw new LightBackgroundError("invalid_png");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  validateDimensions(view.getUint32(16), view.getUint32(20));
}

function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > maximumPixels) {
    throw new LightBackgroundError("image_dimensions_unsupported");
  }
}

function isPng(input: Uint8Array) {
  return input.length >= 8 && input[0] === 0x89 && input[1] === 0x50 && input[2] === 0x4e && input[3] === 0x47;
}

function isJpeg(input: Uint8Array) {
  return input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
}

function median(values: number[]) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function clampByte(value: number) {
  return Math.round(Math.max(0, Math.min(255, value)));
}

export class LightBackgroundError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
