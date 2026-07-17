import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { createZeroCostAvatarAsset } from "@/lib/zero-vision/avatar";
import { ZeroVisionError } from "@/lib/zero-vision/core";
import { getMediaBucket, ownerAvatarKey } from "@/lib/storage";

const maximumImageBytes = 12 * 1024 * 1024;

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure("zero_cost_avatar_form_invalid", 400);
  }
  const image = form.get("image");
  if (!(image instanceof File) || !isSupportedImage(image)) return failure("zero_cost_avatar_image_invalid", 400);

  let asset;
  try {
    asset = createZeroCostAvatarAsset(new Uint8Array(await image.arrayBuffer()), image.type);
  } catch (error) {
    const code = error instanceof ZeroVisionError ? error.code : "zero_cost_avatar_failed";
    return failure(code, 422);
  }

  if (!asset.accepted) {
    return Response.json({
      error: "zero_cost_avatar_quality_low",
      score: asset.score,
      reasons: asset.reasons,
      guidance: avatarGuidance(asset.reasons),
      paidFallbackAvailable: true,
      modelCostUsd: 0,
    }, { status: 422, headers: privateHeaders() });
  }

  const db = getDb();
  const [owner] = await db.select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  if (!owner) return failure("owner_not_found", 404);

  const version = crypto.randomUUID();
  const key = ownerAvatarKey(identity.ownerId, version);
  const now = new Date().toISOString();
  const bucket = getMediaBucket();
  await bucket.put(key, asset.png, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      ownerId: identity.ownerId,
      version,
      purpose: "private-canonical-photo-avatar",
      algorithm: "zero-vision-avatar-v1",
      qualityScore: String(asset.score),
      modelCostUsd: "0",
    },
  });

  try {
    await db.update(users).set({
      avatarKey: key,
      avatarVersion: version,
      avatarUpdatedAt: now,
      updatedAt: now,
    }).where(eq(users.id, identity.ownerId));
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    throw error;
  }
  if (owner.avatarKey && owner.avatarKey !== key) await bucket.delete(owner.avatarKey).catch(() => undefined);

  return Response.json({
    ok: true,
    modelCostUsd: 0,
    score: asset.score,
    reasons: asset.reasons,
    avatar: {
      mediaPath: `/api/v1/media/avatar?v=${encodeURIComponent(version)}`,
      version,
      updatedAt: now,
    },
  }, { status: 201, headers: privateHeaders() });
}

function isSupportedImage(file: File) {
  return file.size > 0 && file.size <= maximumImageBytes && ["image/jpeg", "image/png"].includes(file.type.toLowerCase());
}

function avatarGuidance(reasons: string[]) {
  if (reasons.includes("background_not_uniform")) return "Párate frente a una pared lisa que contraste con tu ropa. Evita espejos, muebles y sombras fuertes.";
  if (reasons.includes("body_clipped") || reasons.includes("foreground_touches_frame")) return "Incluye cabeza, manos y ambos pies, dejando margen arriba y abajo.";
  if (reasons.includes("body_too_small")) return "Acércate hasta que tu cuerpo ocupe aproximadamente tres cuartas partes de la imagen.";
  if (reasons.includes("body_not_centered")) return "Colócate en el centro, de frente, con brazos ligeramente separados del torso.";
  return "Usa ropa ajustada y neutra, luz uniforme, postura frontal y un fondo liso contrastante.";
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
