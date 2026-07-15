import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { needsLegacyAvatarRestore } from "@/lib/avatar-migration";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket, ownerAvatarKey } from "@/lib/storage";

const maximumAvatarBytes = 15 * 1024 * 1024;

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const [owner] = await getDb().select({
    avatarKey: users.avatarKey,
    avatarVersion: users.avatarVersion,
    avatarUpdatedAt: users.avatarUpdatedAt,
  }).from(users).where(eq(users.id, identity.ownerId)).limit(1);
  return Response.json({
    legacyAvatarEligible: needsLegacyAvatarRestore(identity.ownerId, owner),
    avatar: owner?.avatarKey && owner.avatarVersion ? {
      mediaPath: `/api/v1/media/avatar?v=${encodeURIComponent(owner.avatarVersion)}`,
      version: owner.avatarVersion,
      updatedAt: owner.avatarUpdatedAt,
    } : null,
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
