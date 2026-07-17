import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptionEntitlements, subscriptionUsage } from "@/db/schema";
import { allowancesForProduct } from "@/lib/subscription-plans";

export type MeteredUsageKind = "wardrobe_addition" | "look_generation";

export async function requireUsageCapacity(ownerId: string, kind: MeteredUsageKind, amount = 1) {
  const db = getDb();
  const [entitlement] = await db.select().from(subscriptionEntitlements)
    .where(eq(subscriptionEntitlements.ownerId, ownerId)).limit(1);
  if (!entitlement || entitlement.status !== "active" || entitlement.expiresAt <= new Date().toISOString()) {
    throw new SubscriptionUsageError("subscription_required", 402);
  }
  const allowances = allowancesForProduct(entitlement.productId);
  if (!allowances) throw new SubscriptionUsageError("subscription_plan_unavailable", 402);
  const [usage] = await db.select({ value: sql<number>`coalesce(sum(${subscriptionUsage.amount}), 0)` })
    .from(subscriptionUsage).where(and(
      eq(subscriptionUsage.ownerId, ownerId),
      eq(subscriptionUsage.originalTransactionId, entitlement.originalTransactionId),
      eq(subscriptionUsage.periodStart, entitlement.purchasedAt),
      eq(subscriptionUsage.periodEnd, entitlement.expiresAt),
      ne(subscriptionUsage.status, "released"),
    ));
  const limit = allowances.credits;
  if (Number(usage?.value || 0) + amount > limit) throw new SubscriptionUsageError("credit_limit_reached", 429, limit);
  return entitlement;
}

export async function recordConsumedUsage(
  ownerId: string,
  kind: MeteredUsageKind,
  amount: number,
  idempotencyKey: string,
  entitlement: Awaited<ReturnType<typeof requireUsageCapacity>>,
) {
  if (amount < 1) return;
  const now = new Date().toISOString();
  await getDb().insert(subscriptionUsage).values({
    id: `usage_${crypto.randomUUID()}`,
    ownerId,
    originalTransactionId: entitlement.originalTransactionId,
    kind,
    amount,
    idempotencyKey: idempotencyKey.slice(0, 160),
    periodStart: entitlement.purchasedAt,
    periodEnd: entitlement.expiresAt,
    status: "consumed",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
}

export class SubscriptionUsageError extends Error {
  constructor(public code: string, public status: number, public limit?: number) {
    super(code);
  }
}
