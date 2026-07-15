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

export function normalizedPhotoKey(ownerId: string, batchId: string, photoId: string) {
  return `owners/${ownerId}/normalized/${batchId}/${photoId}.jpg`;
}

export function garmentCutoutKey(ownerId: string, garmentId: string) {
  return `owners/${ownerId}/garments/${garmentId}/cutout.png`;
}

export function garmentReconstructionKey(ownerId: string, garmentId: string) {
  return `owners/${ownerId}/garments/${garmentId}/reconstruction-chroma.png`;
}

export function garmentPreviewKey(ownerId: string, garmentId: string) {
  return `owners/${ownerId}/garments/${garmentId}/evidence.jpg`;
}

export function outfitRenderKey(ownerId: string, outfitId: string) {
  return `owners/${ownerId}/outfits/${outfitId}/render.png`;
}

export function ownerAvatarKey(ownerId: string, version: string) {
  return `owners/${ownerId}/avatar/${version}.png`;
}
