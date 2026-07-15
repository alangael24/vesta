import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const [owner] = await getDb().select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  if (!owner?.avatarKey) return Response.json({ error: "avatar_not_found" }, { status: 404 });
  const object = await getMediaBucket().get(owner.avatarKey);
  if (!object) return Response.json({ error: "avatar_not_found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
