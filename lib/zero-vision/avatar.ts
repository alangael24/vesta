import { canonicalizeAvatarPhoto, type PixelBounds, ZeroVisionError } from "./core";
import { decodeRaster, encodeRasterPng } from "./raster";

export type ZeroCostAvatarAsset = {
  png: Uint8Array;
  score: number;
  accepted: boolean;
  reasons: string[];
  sourceBounds: PixelBounds | null;
  width: number;
  height: number;
};

export function createZeroCostAvatarAsset(bytes: Uint8Array, contentType: string): ZeroCostAvatarAsset {
  const image = decodeRaster(bytes, contentType);
  const result = canonicalizeAvatarPhoto(image, 1024, 1536);
  if (!result.sourceBounds) throw new ZeroVisionError("person_not_separated", "The person could not be separated from the background.");
  return {
    png: encodeRasterPng(result.image),
    score: result.score,
    accepted: result.accepted,
    reasons: result.reasons,
    sourceBounds: result.sourceBounds,
    width: result.image.width,
    height: result.image.height,
  };
}
