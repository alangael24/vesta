import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ photoId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const { photoId } = await context.params;
  const [photo] = await getDb().select().from(sourcePhotos).where(and(
    eq(sourcePhotos.id, photoId),
    eq(sourcePhotos.ownerId, identity.ownerId),
  )).limit(1);
  if (!photo || photo.status === "deleted") {
    return Response.json({ error: "photo_not_found" }, { status: 404 });
  }

  const object = await getMediaBucket().get(photo.r2Key);
  if (!object) return Response.json({ error: "photo_not_found" }, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
