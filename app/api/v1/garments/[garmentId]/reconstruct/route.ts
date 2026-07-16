import { waitUntil } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, processingJobs } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getOpenAIKey } from "@/lib/openai";
import { reconstructAndVerify, ReconstructionError, ReconstructionMode } from "@/lib/reconstruction";

type RouteContext = { params: Promise<{ garmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { garmentId } = await context.params;
  const db = getDb();
  const [garment] = await db.select({ id: garments.id, status: garments.status }).from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, identity.ownerId),
  )).limit(1);
  if (!garment) return Response.json({ error: "garment_not_found" }, { status: 404 });
  const [job] = await db.select({
    id: processingJobs.id,
    status: processingJobs.status,
    progress: processingJobs.progress,
    errorCode: processingJobs.errorCode,
  }).from(processingJobs).where(and(
    eq(processingJobs.ownerId, identity.ownerId),
    eq(processingJobs.garmentId, garmentId),
    eq(processingJobs.kind, "reconstruct"),
  )).orderBy(desc(processingJobs.createdAt)).limit(1);
  return Response.json({
    configured: Boolean(getOpenAIKey()),
    status: garment.status,
    job: job || null,
    modes: [
      { id: "draft", label: "Borrador económico", model: "gpt-image-2", quality: "low" },
      { id: "final", label: "Recorte final", model: "gpt-image-2", quality: "high" },
    ],
    privacy: { trainsModelsByDefault: false, abuseMonitoringRetentionDays: 30 },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { garmentId } = await context.params;
  const payload = await safeJson(request);
  const mode: ReconstructionMode | null = payload?.mode === "final" ? "final" : payload?.mode === "draft" ? "draft" : null;
  if (!mode || payload?.consent !== true || payload?.acknowledgesOpenAIRetention !== true) {
    return Response.json({ error: "explicit_reconstruction_consent_required" }, { status: 400 });
  }
  if (!getOpenAIKey()) return Response.json({ error: "processing_not_configured" }, { status: 503 });

  const db = getDb();
  const [garment] = await db.select().from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, identity.ownerId),
  )).limit(1);
  if (!garment) return Response.json({ error: "garment_not_found" }, { status: 404 });
  if (!garment.batchId) return Response.json({ error: "garment_batch_missing" }, { status: 409 });
  if (garment.status === "duplicate" || garment.status === "rejected") return Response.json({ error: "garment_not_reconstructable" }, { status: 409 });
  if (garment.status === "held" && payload?.forceHeld !== true) return Response.json({ error: "held_garment_requires_confirmation" }, { status: 409 });
  const [running] = await db.select({ id: processingJobs.id }).from(processingJobs).where(and(
    eq(processingJobs.ownerId, identity.ownerId),
    eq(processingJobs.garmentId, garmentId),
    eq(processingJobs.kind, "reconstruct"),
    eq(processingJobs.status, "running"),
  )).limit(1);
  if (running) return Response.json({ ok: true, status: "reconstructing", jobId: running.id }, { status: 202 });

  const jobId = `job_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  await db.batch([
    db.insert(processingJobs).values({
      id: jobId,
      ownerId: identity.ownerId,
      batchId: garment.batchId,
      garmentId,
      kind: "reconstruct",
      status: "running",
      progress: 10,
      attempts: 1,
      model: "gpt-image-2",
      createdAt: startedAt,
      updatedAt: startedAt,
      startedAt,
    }),
    db.update(garments).set({
      status: "reconstructing",
      reconstructionQuality: mode,
      reconstructionApprovedAt: startedAt,
      updatedAt: startedAt,
    }).where(eq(garments.id, garmentId)),
  ]);

  waitUntil(runReconstructionJob(identity.ownerId, garmentId, jobId, mode, garment.status));
  return Response.json({ ok: true, status: "reconstructing", jobId }, { status: 202 });
}

async function runReconstructionJob(
  ownerId: string,
  garmentId: string,
  jobId: string,
  mode: ReconstructionMode,
  previousStatus: (typeof garments.$inferSelect)["status"],
) {
  const db = getDb();
  try {
    const result = await reconstructAndVerify(ownerId, garmentId, mode);
    const completedAt = new Date().toISOString();
    await db.update(processingJobs).set({
      status: "completed",
      progress: 100,
      resultJson: JSON.stringify(result),
      completedAt,
      updatedAt: completedAt,
    }).where(eq(processingJobs.id, jobId));
  } catch (error) {
    const failedAt = new Date().toISOString();
    const code = error instanceof ReconstructionError ? error.code : "reconstruction_failed";
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Reconstruction failed.";
    await db.batch([
      db.update(processingJobs).set({ status: "failed", errorCode: code, errorMessage: message, updatedAt: failedAt }).where(eq(processingJobs.id, jobId)),
      db.update(garments).set({ status: previousStatus, updatedAt: failedAt }).where(and(
        eq(garments.id, garmentId),
        eq(garments.ownerId, ownerId),
      )),
    ]);
  }
}

async function safeJson(request: Request): Promise<{ mode?: string; consent?: boolean; acknowledgesOpenAIRetention?: boolean; forceHeld?: boolean } | null> {
  try { return await request.json() as { mode?: string; consent?: boolean; acknowledgesOpenAIRetention?: boolean; forceHeld?: boolean }; } catch { return null; }
}
