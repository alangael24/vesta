import {
  createGarmentCutout,
  dominantColorName,
  hammingDistanceHex,
  perceptualHash,
  segmentForeground,
  type NormalizedPoint,
  type NormalizedRect,
  type SegmentationMetrics,
  type SegmentationMode,
  ZeroVisionError,
} from "./core";
import { decodeRaster, encodeRasterPng } from "./raster";

export type ZeroCostGarmentRequest = {
  mode: SegmentationMode;
  rect?: NormalizedRect;
  foregroundPoints?: NormalizedPoint[];
  backgroundPoints?: NormalizedPoint[];
};

export type ZeroCostGarmentAsset = {
  png: Uint8Array;
  hash: string;
  color: { name: string; rgb: [number, number, number] };
  metrics: SegmentationMetrics;
  width: number;
  height: number;
  accepted: boolean;
  reviewRecommended: boolean;
};

export function createZeroCostGarmentAsset(
  bytes: Uint8Array,
  contentType: string,
  request: ZeroCostGarmentRequest,
): ZeroCostGarmentAsset {
  const image = decodeRaster(bytes, contentType);
  const segmentation = segmentForeground(image, request);
  if (segmentation.metrics.foregroundPixelRatio < 3) {
    throw new ZeroVisionError("garment_not_separated", "The garment could not be separated from the background.");
  }
  const cutout = createGarmentCutout(image, segmentation, 1024);
  const color = dominantColorName(image, segmentation.mask);
  const hash = perceptualHash(image, segmentation.mask);
  return {
    png: encodeRasterPng(cutout),
    hash,
    color,
    metrics: segmentation.metrics,
    width: cutout.width,
    height: cutout.height,
    accepted: segmentation.metrics.score >= 62,
    reviewRecommended: segmentation.metrics.score < 78,
  };
}

export function zeroVisionFingerprint(category: string, hash: string) {
  return `zero-vision-v1:${cleanCategory(category)}:${hash.toLowerCase()}`;
}

export function parseZeroVisionFingerprint(value: string | null | undefined) {
  const match = value?.match(/^zero-vision-v1:([^:]+):([0-9a-f]{16})$/u);
  return match ? { category: match[1], hash: match[2] } : null;
}

export function isLikelyDuplicateFingerprint(
  incoming: { category: string; hash: string },
  existing: Array<{ id: string; fingerprint: string | null }>,
  maximumDistance = 5,
) {
  let best: { id: string; distance: number } | null = null;
  for (const candidate of existing) {
    const parsed = parseZeroVisionFingerprint(candidate.fingerprint);
    if (!parsed || parsed.category !== cleanCategory(incoming.category)) continue;
    const distance = hammingDistanceHex(incoming.hash, parsed.hash);
    if (!best || distance < best.distance) best = { id: candidate.id, distance };
  }
  return best && best.distance <= maximumDistance ? best : null;
}

function cleanCategory(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/gu, "_").slice(0, 40) || "unknown";
}
