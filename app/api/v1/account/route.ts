import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { getMediaBucket } from "@/lib/storage";

export async function DELETE(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  try {
    await deleteOwnerMedia(identity.ownerId);
  } catch {
    return Response.json(
      { error: "account_media_delete_failed" },
      { status: 503, headers: privateHeaders() },
    );
  }

  await getDb().delete(users).where(eq(users.id, identity.ownerId));
  return Response.json({ deleted: true }, { headers: privateHeaders() });
}

async function deleteOwnerMedia(ownerId: string) {
  const bucket = getMediaBucket();
  const prefix = `owners/${ownerId}/`;
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((object) => object.key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
