import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";
import { normalizeAvatarBackground } from "@/lib/avatar-background";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const [owner] = await getDb().select({ avatarKey: users.avatarKey }).from(users)
    .where(eq(users.id, identity.ownerId)).limit(1);
  if (!owner?.avatarKey) return Response.json({ error: "avatar_not_found" }, { status: 404 });
  const bucket = getMediaBucket();
  const object = await bucket.get(owner.avatarKey);
  if (!object) return Response.json({ error: "avatar_not_found" }, { status: 404 });
  if (object.customMetadata?.background !== "white") {
    const bytes = new Uint8Array(await object.arrayBuffer());
    const normalized = normalizeAvatarBackground(bytes, object.httpMetadata?.contentType || "image/png");
    if (normalized.applied) {
      await bucket.put(owner.avatarKey, normalized.png, {
        httpMetadata: { contentType: "image/png" },
        customMetadata: { ...object.customMetadata, background: "white" },
      });
      return imageResponse(normalized.png);
    }
    return imageResponse(bytes);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

function imageResponse(bytes: Uint8Array) {
  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
    },
  });
}
