import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ garmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { garmentId } = await context.params;
  const [garment] = await getDb().select({ cutoutKey: garments.cutoutKey, previewKey: garments.previewKey }).from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, identity.ownerId),
  )).limit(1);
  const imageKey = garment?.cutoutKey || garment?.previewKey;
  if (!imageKey) return Response.json({ error: "garment_image_not_found" }, { status: 404 });
  const object = await getMediaBucket().get(imageKey);
  if (!object) return Response.json({ error: "garment_image_not_found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
