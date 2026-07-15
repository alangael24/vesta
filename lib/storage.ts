import { env } from "cloudflare:workers";

export function getMediaBucket(): R2Bucket {
  const bucket = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!bucket) {
    throw new Error("Cloudflare R2 binding `MEDIA` is unavailable.");
  }
  return bucket;
}

export function originalPhotoKey(ownerId: string, batchId: string, photoId: string) {
  return `owners/${ownerId}/originals/${batchId}/${photoId}`;
}

export function garmentCutoutKey(ownerId: string, garmentId: string) {
  return `owners/${ownerId}/garments/${garmentId}/cutout.png`;
}

export function outfitRenderKey(ownerId: string, outfitId: string) {
  return `owners/${ownerId}/outfits/${outfitId}/render.png`;
}
