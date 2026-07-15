import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { devices } from "@/db/schema";
import { hashSecret } from "@/lib/crypto";

export type DeviceIdentity = {
  deviceId: string;
  ownerId: string;
};

export async function requireDevice(request: Request): Promise<DeviceIdentity | Response> {
  const token = request.headers.get("x-vesta-device-token")?.trim();
  if (!token) return unauthorized();

  const tokenHash = await hashSecret(token);
  const db = getDb();
  const [device] = await db.select({ id: devices.id, ownerId: devices.ownerId })
    .from(devices)
    .where(and(eq(devices.tokenHash, tokenHash), isNull(devices.revokedAt)))
    .limit(1);

  if (!device) return unauthorized();

  await db.update(devices).set({ lastSeenAt: new Date().toISOString() }).where(eq(devices.id, device.id));
  return { deviceId: device.id, ownerId: device.ownerId };
}

function unauthorized() {
  return Response.json({ error: "device_not_paired" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
