import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { devices, users } from "@/db/schema";
import { hashSecret, randomToken } from "@/lib/crypto";

type ManualDevicePayload = {
  email?: string;
  deviceId?: string;
};

type RuntimeEnv = {
  VESTA_MANUAL_IMPORT_SECRET?: string;
};

export async function POST(request: Request) {
  if (!authorized(request)) return unauthorized();

  const payload = await safeJson(request);
  const email = payload?.email?.trim().toLowerCase();
  if (!email) return Response.json({ error: "email_required" }, { status: 400 });

  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });

  const deviceToken = randomToken(32);
  const deviceId = `dev_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(devices).values({
    id: deviceId,
    ownerId: owner.id,
    name: "Importacion manual temporal",
    platform: "ios",
    tokenHash: await hashSecret(deviceToken),
    createdAt: now,
    lastSeenAt: now,
  });

  return Response.json({ deviceToken, deviceId, ownerId: owner.id }, {
    status: 201,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return unauthorized();

  const payload = await safeJson(request);
  const deviceId = payload?.deviceId?.trim();
  if (!deviceId) return Response.json({ error: "device_id_required" }, { status: 400 });

  await getDb().update(devices)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(devices.id, deviceId));
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

function authorized(request: Request) {
  const configured = (env as unknown as RuntimeEnv).VESTA_MANUAL_IMPORT_SECRET?.trim();
  const supplied = request.headers.get("x-vesta-manual-secret")?.trim();
  return Boolean(configured && supplied && configured === supplied);
}

function unauthorized() {
  return Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
}

async function safeJson(request: Request): Promise<ManualDevicePayload | null> {
  try {
    return await request.json() as ManualDevicePayload;
  } catch {
    return null;
  }
}
