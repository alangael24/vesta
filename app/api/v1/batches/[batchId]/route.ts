import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches, processingJobs } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";

type RouteContext = { params: Promise<{ batchId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { batchId } = await context.params;
  const [batch] = await getDb().select().from(importBatches).where(and(
    eq(importBatches.id, batchId),
    eq(importBatches.ownerId, identity.ownerId),
  )).limit(1);
  if (!batch) return Response.json({ error: "batch_not_found" }, { status: 404 });
  const jobs = await getDb().select().from(processingJobs).where(and(
    eq(processingJobs.batchId, batchId),
    eq(processingJobs.ownerId, identity.ownerId),
  ));
  return Response.json({ batch, jobs }, { headers: { "Cache-Control": "private, no-store" } });
}

