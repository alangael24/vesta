import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { devices, pairingCodes } from "@/db/schema";
import { hashSecret, randomToken } from "@/lib/crypto";

type PairingPayload = {
  code?: string;
  name?: string;
  platform?: "ios" | "android";
};

export async function POST(request: Request) {
  const payload = await safeJson(request);
  if (!payload?.code || !payload.platform) {
    return Response.json({ error: "invalid_pairing_request" }, { status: 400 });
  }

  const db = getDb();
  const codeHash = await hashSecret(payload.code);
  const now = new Date().toISOString();
  const [pairing] = await db.select()
    .from(pairingCodes)
    .where(and(
      eq(pairingCodes.codeHash, codeHash),
      isNull(pairingCodes.consumedAt),
      gt(pairingCodes.expiresAt, now),
    ))
    .limit(1);

  if (!pairing) {
    return Response.json({ error: "pairing_expired_or_invalid" }, { status: 401 });
  }

  const deviceToken = randomToken(32);
  const deviceId = `dev_${crypto.randomUUID()}`;
  await db.batch([
    db.insert(devices).values({
      id: deviceId,
      ownerId: pairing.ownerId,
      name: payload.name?.trim().slice(0, 80) || (payload.platform === "ios" ? "iPhone" : "Android"),
      platform: payload.platform,
      tokenHash: await hashSecret(deviceToken),
      createdAt: now,
      lastSeenAt: now,
    }),
    db.update(pairingCodes).set({ consumedAt: now }).where(eq(pairingCodes.id, pairing.id)),
  ]);

  return Response.json({
    deviceToken,
    deviceId,
    ownerId: pairing.ownerId,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function safeJson(request: Request): Promise<PairingPayload | null> {
  try {
    return await request.json() as PairingPayload;
  } catch {
    return null;
  }
}
