import { and, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptionEntitlements, subscriptionUsage } from "@/db/schema";
import { verifyAppleSubscription } from "@/lib/apple-subscription";
import { allowancesForProduct } from "@/lib/subscription-plans";
import { requireDevice } from "@/lib/device-auth";

export async function GET(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  return Response.json(await entitlementStatus(identity.ownerId), { headers: privateHeaders() });
}

export async function POST(request: Request) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const body = await safeJson(request);
  if (!body?.signedTransaction || typeof body.signedTransaction !== "string") {
    return Response.json({ error: "signed_transaction_required" }, { status: 400, headers: privateHeaders() });
  }
  try {
    const verified = await verifyAppleSubscription(body.signedTransaction);
    const db = getDb();
    const [claimed] = await db.select({ ownerId: subscriptionEntitlements.ownerId })
      .from(subscriptionEntitlements)
      .where(and(
        eq(subscriptionEntitlements.originalTransactionId, verified.originalTransactionId),
        ne(subscriptionEntitlements.ownerId, identity.ownerId),
      )).limit(1);
    if (claimed) return Response.json({ error: "subscription_belongs_to_another_account" }, { status: 409, headers: privateHeaders() });
    const now = new Date().toISOString();
    await db.insert(subscriptionEntitlements).values({
      ownerId: identity.ownerId,
      ...verified,
      verifiedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: subscriptionEntitlements.ownerId,
      set: {
        productId: verified.productId,
        originalTransactionId: verified.originalTransactionId,
        transactionId: verified.transactionId,
        environment: verified.environment,
        purchasedAt: verified.purchasedAt,
        expiresAt: verified.expiresAt,
        status: verified.status,
        verifiedAt: now,
        updatedAt: now,
      },
    });
    return Response.json(await entitlementStatus(identity.ownerId), { headers: privateHeaders() });
  } catch {
    return Response.json({ error: "subscription_verification_failed" }, { status: 422, headers: privateHeaders() });
  }
}

async function entitlementStatus(ownerId: string) {
  const db = getDb();
  const [entitlement] = await db.select().from(subscriptionEntitlements)
    .where(eq(subscriptionEntitlements.ownerId, ownerId)).limit(1);
  const active = Boolean(entitlement?.status === "active" && entitlement.expiresAt > new Date().toISOString());
  if (!entitlement) return { active: false, plan: null, allowances: null, usage: null };
  const [usage] = await db.select({
    credits: sql<number>`coalesce(sum(case when ${subscriptionUsage.status} != 'released' then ${subscriptionUsage.amount} else 0 end), 0)`,
  }).from(subscriptionUsage).where(and(
    eq(subscriptionUsage.ownerId, ownerId),
    eq(subscriptionUsage.originalTransactionId, entitlement.originalTransactionId),
    eq(subscriptionUsage.periodStart, entitlement.purchasedAt),
    eq(subscriptionUsage.periodEnd, entitlement.expiresAt),
  ));
  const allowances = allowancesForProduct(entitlement.productId);
  return {
    active,
    plan: entitlement.productId,
    periodStart: entitlement.purchasedAt,
    periodEnd: entitlement.expiresAt,
    allowances: allowances ? { credits: allowances.credits } : null,
    usage: {
      credits: Number(usage?.credits || 0),
    },
  };
}

async function safeJson(request: Request) {
  try {
    return await request.json() as { signedTransaction?: string };
  } catch {
    return null;
  }
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
