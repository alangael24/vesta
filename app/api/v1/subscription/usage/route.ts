import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptionEntitlements, subscriptionUsage } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { subscriptionProductIds, weeklyAllowances } from "@/lib/subscription-plans";

type UsageKind = "wardrobe_addition" | "look_generation";
type UsageAction = "reserve" | "consume" | "release";

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const body = await safeJson(request);
  if (!body || !["reserve", "consume", "release"].includes(body.action || "")) return failure("invalid_usage_action", 400);

  const db = getDb();
  if (body.action === "consume" || body.action === "release") {
    if (!body.reservationId) return failure("reservation_required", 400);
    const status = body.action === "consume" ? "consumed" : "released";
    await db.update(subscriptionUsage).set({ status, updatedAt: new Date().toISOString() }).where(and(
      eq(subscriptionUsage.id, body.reservationId),
      eq(subscriptionUsage.ownerId, identity.ownerId),
      eq(subscriptionUsage.status, "reserved"),
    ));
    return Response.json({ ok: true, reservationId: body.reservationId, status }, { headers: privateHeaders() });
  }

  if (!body.kind || !["wardrobe_addition", "look_generation"].includes(body.kind) || !body.idempotencyKey) {
    return failure("invalid_usage_reservation", 400);
  }
  const amount = integerBetween(body.amount, 1, 50) ? Number(body.amount) : 1;
  const [entitlement] = await db.select().from(subscriptionEntitlements)
    .where(eq(subscriptionEntitlements.ownerId, identity.ownerId)).limit(1);
  if (!entitlement || entitlement.status !== "active" || entitlement.expiresAt <= new Date().toISOString()) {
    return failure("subscription_required", 402);
  }
  if (entitlement.productId !== subscriptionProductIds.weekly) {
    return Response.json({ ok: true, metered: false }, { headers: privateHeaders() });
  }
  const [existing] = await db.select().from(subscriptionUsage).where(and(
    eq(subscriptionUsage.ownerId, identity.ownerId),
    eq(subscriptionUsage.idempotencyKey, body.idempotencyKey),
  )).limit(1);
  if (existing) {
    if (existing.status === "released") return failure("usage_reservation_released", 409);
    return Response.json({ ok: true, metered: true, reservationId: existing.id, status: existing.status }, { headers: privateHeaders() });
  }

  const reservationId = `usage_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.insert(subscriptionUsage).values({
    id: reservationId,
    ownerId: identity.ownerId,
    originalTransactionId: entitlement.originalTransactionId,
    kind: body.kind as UsageKind,
    amount,
    idempotencyKey: body.idempotencyKey.slice(0, 160),
    periodStart: entitlement.purchasedAt,
    periodEnd: entitlement.expiresAt,
    status: "reserved",
    createdAt: now,
    updatedAt: now,
  });
  const [total] = await db.select({ value: sql<number>`coalesce(sum(${subscriptionUsage.amount}), 0)` })
    .from(subscriptionUsage).where(and(
      eq(subscriptionUsage.ownerId, identity.ownerId),
      eq(subscriptionUsage.originalTransactionId, entitlement.originalTransactionId),
      eq(subscriptionUsage.periodStart, entitlement.purchasedAt),
      eq(subscriptionUsage.periodEnd, entitlement.expiresAt),
      eq(subscriptionUsage.kind, body.kind as UsageKind),
      ne(subscriptionUsage.status, "released"),
    ));
  const limit = body.kind === "wardrobe_addition" ? weeklyAllowances.wardrobeAddition : weeklyAllowances.lookGeneration;
  if (Number(total?.value || 0) > limit) {
    await db.update(subscriptionUsage).set({ status: "released", updatedAt: new Date().toISOString() })
      .where(eq(subscriptionUsage.id, reservationId));
    return Response.json({ error: "weekly_limit_reached", kind: body.kind, limit }, { status: 429, headers: privateHeaders() });
  }
  return Response.json({ ok: true, metered: true, reservationId, status: "reserved", limit, used: Number(total?.value || 0) }, { headers: privateHeaders() });
}

async function safeJson(request: Request) {
  try {
    return await request.json() as { action?: UsageAction; kind?: UsageKind; amount?: number; idempotencyKey?: string; reservationId?: string };
  } catch {
    return null;
  }
}

function integerBetween(value: unknown, minimum: number, maximum: number) {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
