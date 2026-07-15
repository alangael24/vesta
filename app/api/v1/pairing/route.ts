import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { pairingCodes, users } from "@/db/schema";
import { hashSecret, ownerIdForEmail, randomToken } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "sign_in_required" }, { status: 401 });

  const dispatchToken = process.env.VESTA_DISPATCH_BYPASS_TOKEN;
  if (!dispatchToken) {
    return Response.json({ error: "pairing_not_configured" }, { status: 503 });
  }

  const db = getDb();
  const ownerId = await ownerIdForEmail(user.email);
  const now = new Date().toISOString();
  await db.insert(users).values({
    id: ownerId,
    email: user.email.trim().toLowerCase(),
    displayName: user.displayName,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: users.id,
    set: { displayName: user.displayName, updatedAt: now },
  });

  const code = randomToken(18);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.delete(pairingCodes).where(eq(pairingCodes.ownerId, ownerId));
  await db.insert(pairingCodes).values({
    id: crypto.randomUUID(),
    ownerId,
    codeHash: await hashSecret(code),
    expiresAt,
    createdAt: now,
  });

  const params = new URLSearchParams({
    api: "https://vesta-armario-alan.alangael2411.chatgpt.site",
    dispatch: dispatchToken,
    code,
  });

  return Response.json({
    pairingUrl: `vesta://pair?${params.toString()}`,
    expiresAt,
  }, { headers: { "Cache-Control": "no-store" } });
}
