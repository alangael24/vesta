import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { devices, subscriptionEntitlements, users } from "@/db/schema";
import { hashSecret, ownerIdForEmail, randomToken } from "@/lib/crypto";
import { subscriptionProductIds } from "@/lib/subscription-plans";

type Payload = { email?: string; password?: string; name?: string };

export async function POST(request: Request) {
  const payload = await safeJson(request);
  const configuredEmail = process.env.VESTA_REVIEW_EMAIL?.trim().toLowerCase();
  const configuredPassword = process.env.VESTA_REVIEW_PASSWORD;
  const email = payload?.email?.trim().toLowerCase();
  const password = payload?.password || "";

  if (!configuredEmail || !configuredPassword) return unavailable();
  const [emailHash, configuredEmailHash, passwordHash, configuredPasswordHash] = await Promise.all([
    hashSecret(email || "missing"),
    hashSecret(configuredEmail),
    hashSecret(password || "missing"),
    hashSecret(configuredPassword),
  ]);
  if (emailHash !== configuredEmailHash || passwordHash !== configuredPasswordHash) {
    return Response.json({ error: "invalid_review_credentials" }, { status: 401, headers: privateHeaders() });
  }

  const db = getDb();
  const ownerId = await ownerIdForEmail(configuredEmail);
  const deviceId = `review_${crypto.randomUUID()}`;
  const deviceToken = randomToken(32);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  await db.insert(users).values({
    id: ownerId,
    email: configuredEmail,
    displayName: "Apple App Review",
    createdAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({ target: users.id, set: { displayName: "Apple App Review", updatedAt: nowIso } });

  await db.insert(devices).values({
    id: deviceId,
    ownerId,
    name: payload?.name?.trim().slice(0, 80) || "Apple App Review",
    platform: "ios",
    tokenHash: await hashSecret(deviceToken),
    createdAt: nowIso,
    lastSeenAt: nowIso,
  });

  await db.insert(subscriptionEntitlements).values({
    ownerId,
    productId: subscriptionProductIds.weekly,
    originalTransactionId: `app-review-${ownerId}`,
    transactionId: `app-review-${ownerId}`,
    environment: "Sandbox",
    purchasedAt: nowIso,
    expiresAt,
    status: "active",
    verifiedAt: nowIso,
    updatedAt: nowIso,
  }).onConflictDoUpdate({
    target: subscriptionEntitlements.ownerId,
    set: { expiresAt, status: "active", verifiedAt: nowIso, updatedAt: nowIso },
  });

  return Response.json({
    apiUrl: new URL(request.url).origin,
    dispatchToken: process.env.VESTA_DISPATCH_BYPASS_TOKEN || "public",
    deviceId,
    deviceToken,
  }, { status: 201, headers: privateHeaders() });
}

async function safeJson(request: Request): Promise<Payload | null> {
  try { return await request.json() as Payload; } catch { return null; }
}

function unavailable() {
  return Response.json({ error: "review_login_unavailable" }, { status: 503, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
