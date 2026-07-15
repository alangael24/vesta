import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, importBatches, processingJobs, sourcePhotos, users } from "@/db/schema";
import { InventoryCandidate, persistExperimentalInventory } from "@/lib/inventory";
import { getMediaBucket } from "@/lib/storage";
import { originalPhotoKey } from "@/lib/storage";

type RuntimeEnv = {
  VESTA_MANUAL_IMPORT_SECRET?: string;
};

type ManualCandidate = Omit<InventoryCandidate, "evidence"> & {
  evidence: Array<{
    source_index: number;
    bbox: { x: number; y: number; width: number; height: number };
  }>;
};

type ManualInventory = {
  garments?: ManualCandidate[];
};

type ManualDeletePayload = {
  email?: string;
  garmentIds?: string[];
};

export async function PUT(request: Request) {
  if (!authorized(request)) return notFound();
  if (request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return deleteGarments(request);
  }

  const form = await request.formData();
  const email = String(form.get("email") || "").trim().toLowerCase();
  const inventory = parseInventory(form.get("inventory"));
  const photos = form.getAll("photos").filter((value): value is File => value instanceof File);
  if (!email || !inventory?.garments?.length || photos.length < 1 || photos.length > 40) {
    return Response.json({ error: "invalid_manual_import" }, { status: 400 });
  }
  if (inventory.garments.some((garment) => garment.evidence.some((item) => (
    !Number.isInteger(item.source_index) || item.source_index < 0 || item.source_index >= photos.length
  )))) {
    return Response.json({ error: "invalid_manual_evidence" }, { status: 400 });
  }

  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });

  const batchId = `batch_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const rows = photos.map((photo) => {
    const id = `photo_${crypto.randomUUID()}`;
    return {
      id,
      ownerId: owner.id,
      batchId,
      r2Key: originalPhotoKey(owner.id, batchId, id),
      filename: photo.name.slice(0, 180) || `${id}.jpg`,
      contentType: photo.type || "image/jpeg",
      sizeBytes: photo.size,
      width: null,
      height: null,
      status: "uploaded" as const,
      createdAt: now,
      uploadedAt: now,
    };
  });
  const bucket = getMediaBucket();

  try {
    await db.insert(importBatches).values({
      id: batchId,
      ownerId: owner.id,
      deviceId: null,
      photoCount: rows.length,
      totalBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
      status: "uploaded",
      originalsPolicy: "retain_private",
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < rows.length; index += 1) {
      await bucket.put(rows[index].r2Key, photos[index].stream(), {
        httpMetadata: { contentType: rows[index].contentType },
        customMetadata: { ownerId: owner.id, batchId, photoId: rows[index].id },
      });
      await db.insert(sourcePhotos).values(rows[index]);
    }

    const results = [{
      garments: inventory.garments.map((garment) => ({
        ...garment,
        evidence: garment.evidence.map((item) => ({
          photo_id: rows[item.source_index].id,
          bbox: item.bbox,
        })),
      })),
    }];
    const persisted = await persistExperimentalInventory(owner.id, batchId, rows, results);
    const completedAt = new Date().toISOString();
    await db.batch([
      db.insert(processingJobs).values({
        id: `job_${batchId}_inventory`,
        ownerId: owner.id,
        batchId,
        kind: "inventory",
        status: "completed",
        progress: 100,
        attempts: 1,
        model: "manual-direct",
        resultJson: JSON.stringify({
          garmentCount: persisted.garmentCount,
          provider: "codex-manual",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        }),
        inputTokens: 0,
        outputTokens: 0,
        createdAt: now,
        updatedAt: completedAt,
        startedAt: now,
        completedAt,
      }),
      db.update(importBatches).set({ status: "review", updatedAt: completedAt }).where(eq(importBatches.id, batchId)),
    ]);
    return Response.json({
      ok: true,
      batchId,
      garmentCount: persisted.garmentCount,
      garments: persisted.garments,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await Promise.all(rows.map((row) => bucket.delete(row.r2Key).catch(() => undefined)));
    await db.delete(importBatches).where(eq(importBatches.id, batchId)).catch(() => undefined);
    return Response.json({
      error: "manual_import_failed",
      detail: error instanceof Error ? error.message.slice(0, 500) : "Unknown import failure.",
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return notFound();
  return deleteGarments(request);
}

async function deleteGarments(request: Request) {
  const payload = await safeJson(request);
  const email = payload?.email?.trim().toLowerCase();
  const garmentIds = Array.from(new Set(payload?.garmentIds?.filter((value) => typeof value === "string") || [])).slice(0, 100);
  if (!email || !garmentIds.length) {
    return Response.json({ error: "invalid_manual_delete" }, { status: 400 });
  }

  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });

  const rows = await db.select({
    id: garments.id,
    cutoutKey: garments.cutoutKey,
    previewKey: garments.previewKey,
  }).from(garments).where(and(
    eq(garments.ownerId, owner.id),
    inArray(garments.id, garmentIds),
  ));
  if (!rows.length) {
    return Response.json({ ok: true, deletedCount: 0 }, { headers: { "Cache-Control": "no-store" } });
  }
  const objectKeys = rows.flatMap((row) => [row.cutoutKey, row.previewKey]).filter((value): value is string => Boolean(value));
  await Promise.all(objectKeys.map((key) => getMediaBucket().delete(key)));
  await db.delete(garments).where(and(
    eq(garments.ownerId, owner.id),
    inArray(garments.id, rows.map((row) => row.id)),
  ));
  return Response.json({ ok: true, deletedCount: rows.length }, { headers: { "Cache-Control": "no-store" } });
}

function authorized(request: Request) {
  const configured = (env as unknown as RuntimeEnv).VESTA_MANUAL_IMPORT_SECRET?.trim();
  const supplied = request.headers.get("x-vesta-manual-secret")?.trim();
  return Boolean(configured && supplied && configured === supplied);
}

function notFound() {
  return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function parseInventory(value: FormDataEntryValue | null): ManualInventory | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as ManualInventory;
  } catch {
    return null;
  }
}

async function safeJson(request: Request): Promise<ManualDeletePayload | null> {
  try {
    return await request.json() as ManualDeletePayload;
  } catch {
    return null;
  }
}
