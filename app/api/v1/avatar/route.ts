import { waitUntil } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { avatarGenerationJobs, users } from "@/db/schema";
import { AvatarGenerationError, generateCanonicalAvatar } from "@/lib/avatar-generation";
import { needsLegacyAvatarRestore } from "@/lib/avatar-migration";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket, ownerAvatarKey } from "@/lib/storage";

const maximumAvatarBytes = 15 * 1024 * 1024;
const maximumReferenceBytes = 8 * 1024 * 1024;

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const [owner] = await getDb().select({
    avatarKey: users.avatarKey,
    avatarVersion: users.avatarVersion,
    avatarUpdatedAt: users.avatarUpdatedAt,
  }).from(users).where(eq(users.id, identity.ownerId)).limit(1);
  const [generation] = await getDb().select({
    requestId: avatarGenerationJobs.id,
    status: avatarGenerationJobs.status,
    error: avatarGenerationJobs.errorCode,
    avatarVersion: avatarGenerationJobs.avatarVersion,
  }).from(avatarGenerationJobs)
    .where(eq(avatarGenerationJobs.ownerId, identity.ownerId))
    .orderBy(desc(avatarGenerationJobs.createdAt))
    .limit(1);
  return Response.json({
    legacyAvatarEligible: needsLegacyAvatarRestore(identity.ownerId, owner),
    avatar: owner?.avatarKey && owner.avatarVersion ? {
      mediaPath: `/api/v1/media/avatar?v=${encodeURIComponent(owner.avatarVersion)}`,
      version: owner.avatarVersion,
      updatedAt: owner.avatarUpdatedAt,
    } : null,
    generation: generation || null,
  }, { headers: privateHeaders() });
}

export async function PUT(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  if (request.headers.get("content-type")?.toLowerCase() !== "image/png") {
    return Response.json({ error: "png_required" }, { status: 400 });
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maximumAvatarBytes) {
    return Response.json({ error: "avatar_too_large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > maximumAvatarBytes) {
    return Response.json({ error: "invalid_avatar" }, { status: 400 });
  }

  const db = getDb();
  const [owner] = await db.select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });

  const version = crypto.randomUUID();
  const key = ownerAvatarKey(identity.ownerId, version);
  await getMediaBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId: identity.ownerId, version, purpose: "private-canonical-fitting-avatar" },
  });
  const now = new Date().toISOString();
  await db.update(users).set({
    avatarKey: key,
    avatarVersion: version,
    avatarUpdatedAt: now,
    updatedAt: now,
  }).where(eq(users.id, identity.ownerId));
  if (owner.avatarKey && owner.avatarKey !== key) {
    await getMediaBucket().delete(owner.avatarKey).catch(() => undefined);
  }

  return Response.json({
    ok: true,
    avatar: {
      mediaPath: `/api/v1/media/avatar?v=${encodeURIComponent(version)}`,
      version,
      updatedAt: now,
    },
  }, { headers: privateHeaders() });
}

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "avatar_references_invalid" }, { status: 400, headers: privateHeaders() });
  }
  const selfie = form.get("selfie");
  const fullBody = form.get("fullBody");
  const requestId = cleanRequestId(form.get("requestId"));
  if (!requestId || !(selfie instanceof File) || !(fullBody instanceof File)) {
    return Response.json({ error: "avatar_references_required" }, { status: 400, headers: privateHeaders() });
  }
  if (!isSupportedReference(selfie) || !isSupportedReference(fullBody)) {
    return Response.json({ error: "avatar_reference_invalid" }, { status: 400, headers: privateHeaders() });
  }

  const db = getDb();
  const [requestCollision] = await db.select({ ownerId: avatarGenerationJobs.ownerId }).from(avatarGenerationJobs)
    .where(eq(avatarGenerationJobs.id, requestId)).limit(1);
  if (requestCollision && requestCollision.ownerId !== identity.ownerId) {
    return Response.json({ error: "avatar_request_conflict" }, { status: 409, headers: privateHeaders() });
  }
  const [existing] = await db.select().from(avatarGenerationJobs).where(and(
    eq(avatarGenerationJobs.id, requestId),
    eq(avatarGenerationJobs.ownerId, identity.ownerId),
  )).limit(1);
  if (existing?.status === "completed" && existing.avatarVersion) {
    return Response.json({ status: "completed", avatarVersion: existing.avatarVersion }, { headers: privateHeaders() });
  }
  if (existing?.status === "running") {
    return Response.json({ status: "running", requestId }, { status: 202, headers: privateHeaders() });
  }

  const now = new Date().toISOString();
  await db.insert(avatarGenerationJobs).values({
    id: requestId,
    ownerId: identity.ownerId,
    status: "running",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: avatarGenerationJobs.id,
    set: { status: "running", errorCode: null, avatarVersion: null, updatedAt: now, completedAt: null },
  });
  waitUntil(runAvatarGeneration(identity.ownerId, requestId, selfie, fullBody));
  return Response.json({ status: "running", requestId }, { status: 202, headers: privateHeaders() });
}

export async function DELETE(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const db = getDb();
  const [owner] = await db.select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });
  const now = new Date().toISOString();
  await db.update(users).set({
    avatarKey: null,
    avatarVersion: null,
    // Keep a tombstone so a deliberately deleted legacy avatar is not restored again.
    avatarUpdatedAt: now,
    updatedAt: now,
  }).where(eq(users.id, identity.ownerId));
  if (owner.avatarKey) await getMediaBucket().delete(owner.avatarKey).catch(() => undefined);
  return Response.json({ ok: true }, { headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}

function isSupportedReference(file: File) {
  return file.size > 0
    && file.size <= maximumReferenceBytes
    && ["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase());
}

async function saveAvatar(ownerId: string, bytes: Uint8Array) {
  const db = getDb();
  const [owner] = await db.select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, ownerId)).limit(1);
  if (!owner) throw new AvatarGenerationError("owner_not_found", "Owner not found.");

  const version = crypto.randomUUID();
  const key = ownerAvatarKey(ownerId, version);
  await getMediaBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId, version, purpose: "private-canonical-fitting-avatar" },
  });
  const [stillOwned] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!stillOwned) {
    await getMediaBucket().delete(key);
    throw new AvatarGenerationError("owner_deleted", "The account was removed while avatar generation was running.");
  }
  const now = new Date().toISOString();
  await db.update(users).set({
    avatarKey: key,
    avatarVersion: version,
    avatarUpdatedAt: now,
    updatedAt: now,
  }).where(eq(users.id, ownerId));
  const [persisted] = await db.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).limit(1);
  if (!persisted) {
    await getMediaBucket().delete(key);
    throw new AvatarGenerationError("owner_deleted", "The account was removed while avatar generation was running.");
  }
  if (owner.avatarKey && owner.avatarKey !== key) {
    await getMediaBucket().delete(owner.avatarKey).catch(() => undefined);
  }
  return {
    mediaPath: `/api/v1/media/avatar?v=${encodeURIComponent(version)}`,
    version,
    updatedAt: now,
  };
}

async function runAvatarGeneration(ownerId: string, requestId: string, selfie: File, fullBody: File) {
  const db = getDb();
  try {
    const bytes = await generateCanonicalAvatar(selfie, fullBody);
    const avatar = await saveAvatar(ownerId, bytes);
    const completedAt = new Date().toISOString();
    await db.update(avatarGenerationJobs).set({
      status: "completed",
      avatarVersion: avatar.version,
      errorCode: null,
      completedAt,
      updatedAt: completedAt,
    }).where(and(eq(avatarGenerationJobs.id, requestId), eq(avatarGenerationJobs.ownerId, ownerId)));
  } catch (error) {
    const code = error instanceof AvatarGenerationError ? error.code : "avatar_generation_failed";
    await db.update(avatarGenerationJobs).set({ status: "failed", errorCode: code, updatedAt: new Date().toISOString() })
      .where(and(eq(avatarGenerationJobs.id, requestId), eq(avatarGenerationJobs.ownerId, ownerId)));
  }
}

function cleanRequestId(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^a-z0-9_-]/giu, "").slice(0, 120);
  return cleaned.length >= 8 ? cleaned : null;
}
