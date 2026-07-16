import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, outfitItems, outfits, users } from "@/db/schema";
import { base64ToBytes, getOpenAIKey } from "@/lib/openai";
import { snapshotGarment } from "@/lib/outfit-snapshot";
import { getMediaBucket, outfitRenderKey } from "@/lib/storage";

export type TryOnQuality = "low" | "medium";

type ImageResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
  error?: { message?: string; code?: string };
};

export async function generateVirtualTryOn(ownerId: string, outfitId: string, quality: TryOnQuality) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new VirtualTryOnError("processing_not_configured", "OpenAI processing is not configured.");

  const db = getDb();
  const [outfit] = await db.select({
    id: outfits.id,
    piecesSnapshotJson: outfits.piecesSnapshotJson,
    avatarVersion: outfits.avatarVersion,
    avatarKey: users.avatarKey,
    currentAvatarVersion: users.avatarVersion,
  }).from(outfits)
    .innerJoin(users, eq(users.id, outfits.ownerId))
    .where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, ownerId)))
    .limit(1);
  if (!outfit) throw new VirtualTryOnError("outfit_not_found", "Outfit not found.");
  if (!outfit.avatarKey) throw new VirtualTryOnError("avatar_required", "A confirmed avatar is required.");

  const pieces = await db.select({
    id: garments.id,
    name: garments.name,
    category: garments.category,
    type: garments.type,
    color: garments.color,
    material: garments.material,
    description: garments.description,
    confidence: garments.confidence,
    cutoutKey: garments.cutoutKey,
    position: outfitItems.position,
  }).from(outfitItems)
    .innerJoin(garments, eq(garments.id, outfitItems.garmentId))
    .where(and(eq(outfitItems.outfitId, outfitId), eq(garments.ownerId, ownerId)))
    .orderBy(asc(outfitItems.position));
  if (!pieces.length || pieces.some((piece) => !piece.cutoutKey)) {
    throw new VirtualTryOnError("outfit_cutouts_missing", "Every garment needs a prepared image.");
  }

  const bucket = getMediaBucket();
  const [avatarObject, ...garmentObjects] = await Promise.all([
    bucket.get(outfit.avatarKey),
    ...pieces.map((piece) => bucket.get(piece.cutoutKey!)),
  ]);
  if (!avatarObject) throw new VirtualTryOnError("avatar_media_missing", "The avatar image is unavailable.");
  if (garmentObjects.some((object) => !object)) {
    throw new VirtualTryOnError("garment_media_missing", "A garment image is unavailable.");
  }

  const form = new FormData();
  form.set("model", "gpt-image-2");
  form.set("prompt", tryOnPrompt(pieces));
  form.set("quality", quality);
  form.set("size", quality === "low" ? "768x1024" : "1024x1536");
  form.set("output_format", "png");
  form.set("background", "opaque");
  form.set("moderation", "low");
  form.append("image[]", new Blob([await avatarObject.arrayBuffer()], { type: avatarObject.httpMetadata?.contentType || "image/png" }), "avatar.png");
  for (let index = 0; index < pieces.length; index += 1) {
    const object = garmentObjects[index]!;
    form.append("image[]", new Blob([await object.arrayBuffer()], { type: object.httpMetadata?.contentType || "image/png" }), `garment-${index + 1}.png`);
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json() as ImageResponse;
  if (!response.ok) {
    throw new VirtualTryOnError(payload.error?.code || "try_on_request_failed", payload.error?.message || `OpenAI returned ${response.status}.`);
  }
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded) throw new VirtualTryOnError("try_on_empty_output", "The image model returned no image.");

  const key = outfitRenderKey(ownerId, outfitId);
  const [stillOwned] = await db.select({ id: outfits.id }).from(outfits).where(and(
    eq(outfits.id, outfitId),
    eq(outfits.ownerId, ownerId),
  )).limit(1);
  if (!stillOwned) throw new VirtualTryOnError("outfit_deleted", "The outfit was removed while its render was running.");
  await bucket.put(key, base64ToBytes(encoded), {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId, outfitId, purpose: "private-virtual-try-on-render" },
  });
  const now = new Date().toISOString();
  await db.update(outfits).set({
    renderKey: key,
    piecesSnapshotJson: outfit.piecesSnapshotJson || JSON.stringify(pieces.map(snapshotGarment)),
    avatarVersion: outfit.avatarVersion || outfit.currentAvatarVersion || null,
    status: "ready",
    updatedAt: now,
  }).where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, ownerId)));

  const [persisted] = await db.select({ id: outfits.id }).from(outfits).where(and(
    eq(outfits.id, outfitId),
    eq(outfits.ownerId, ownerId),
  )).limit(1);
  if (!persisted) {
    await bucket.delete(key);
    throw new VirtualTryOnError("outfit_deleted", "The outfit was removed while its render was running.");
  }

  return {
    renderPath: `/api/v1/media/outfits/${outfitId}?v=${encodeURIComponent(now)}`,
    usage: payload.usage || null,
  };
}

function tryOnPrompt(pieces: Array<typeof garments.$inferSelect & { position: number } | {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string | null;
  material: string | null;
  description: string | null;
  confidence: number | null;
  cutoutKey: string | null;
  position: number;
}>) {
  const garmentList = pieces.map((piece, index) => (
    `Image ${index + 2}: ${piece.name}; placement=${placementFor(piece.category, piece.type)}; type=${piece.type}; color=${piece.color || "preserve reference"}; details=${piece.description || "preserve only visible details"}.`
  )).join("\n");
  return `GOAL: identity-preserving photorealistic virtual try-on.
Image 1 is the exact base avatar and must remain the same person. Images 2 onward are the exact garments to dress on that person.
${garmentList}

Create one full-body fashion fitting photograph in which the person from Image 1 is genuinely wearing every referenced garment in its specified anatomical placement. This is an image edit, never a collage or overlay. Make fabric wrap around the body with realistic drape, folds, openings, scale, perspective, occlusion, and contact shadows. Replace neutral base clothes only in selected regions and keep neutral base clothing elsewhere.

Preserve the person's identity, face, hair, skin tone, body shape, proportions, pose, hands, feet, camera angle, framing, lighting, and warm solid background from Image 1. Preserve each garment's real color, silhouette, material, graphics, logos, patterns, trim, pockets, and construction exactly as supported by its reference. Do not invent branding or details. Do not show floating garments, product cutouts, mannequins, hangers, phones, text, extra people, extra limbs, or extra objects. Output only the finished portrait.`;
}

function placementFor(category: string, type: string) {
  const value = `${category} ${type}`.toLowerCase();
  if (/gorra|sombrero|hat|cap|beanie|head/u.test(value)) return "head";
  if (/calzado|zapato|shoe|sneaker|boot|foot/u.test(value)) return "feet";
  if (/pantal|jean|short|falda|skirt|bottom/u.test(value)) return "lower_body";
  if (/chaqueta|chamarra|abrigo|sudadera|hoodie|jacket|coat|layer/u.test(value)) return "outer_layer";
  if (/acces|bolso|bag|reloj|watch|joya|jewel/u.test(value)) return "accessory";
  return "upper_body";
}

export class VirtualTryOnError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}
