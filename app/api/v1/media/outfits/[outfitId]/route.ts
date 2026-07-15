import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ outfitId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { outfitId } = await context.params;
  const [outfit] = await getDb().select({ renderKey: outfits.renderKey }).from(outfits).where(and(
    eq(outfits.id, outfitId),
    eq(outfits.ownerId, identity.ownerId),
  )).limit(1);
  if (!outfit?.renderKey) return Response.json({ error: "outfit_render_not_found" }, { status: 404 });

  const object = await getMediaBucket().get(outfit.renderKey);
  if (!object) return Response.json({ error: "outfit_render_not_found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
