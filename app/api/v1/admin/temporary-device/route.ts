import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { devices, users } from "@/db/schema";
import { hashSecret, randomToken } from "@/lib/crypto";

type Payload = { email?: string; deviceId?: string };

export async function POST(request: Request) {
  if (!await isAdmin(request)) return unauthorized();
  const payload = await safeJson(request);
  const email = payload?.email?.trim().toLowerCase();
  if (!email) return Response.json({ error: "email_required" }, { status: 400 });

  const db = getDb();
  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!owner) return Response.json({ error: "owner_not_found" }, { status: 404 });

  const deviceToken = randomToken(32);
  const deviceId = `admin_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(devices).values({
    id: deviceId,
    ownerId: owner.id,
    name: "Personalización temporal",
    platform: "ios",
    tokenHash: await hashSecret(deviceToken),
    createdAt: now,
    lastSeenAt: now,
  });

  return Response.json({ deviceId, deviceToken }, { status: 201, headers: privateHeaders() });
}

export async function DELETE(request: Request) {
  if (!await isAdmin(request)) return unauthorized();
  const payload = await safeJson(request);
  if (!payload?.deviceId?.startsWith("admin_")) {
    return Response.json({ error: "temporary_device_required" }, { status: 400 });
  }

  const db = getDb();
  await db.update(devices).set({ revokedAt: new Date().toISOString() }).where(and(
    eq(devices.id, payload.deviceId),
    isNull(devices.revokedAt),
  ));
  return Response.json({ revoked: true }, { headers: privateHeaders() });
}

async function isAdmin(request: Request) {
  const expected = process.env.VESTA_ADMIN_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "");
  if (!expected || !supplied) return false;
  return await hashSecret(expected) === await hashSecret(supplied);
}

async function safeJson(request: Request): Promise<Payload | null> {
  try {
    return await request.json() as Payload;
  } catch {
    return null;
  }
}

function unauthorized() {
  return Response.json({ error: "admin_unauthorized" }, { status: 401, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
