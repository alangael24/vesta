import assert from "node:assert/strict";
import test from "node:test";
import { allowancesForProduct, subscriptionProductIds } from "../lib/subscription-plans.ts";
import { verifyAppleSubscription } from "../lib/apple-subscription.ts";
import { readFileSync } from "node:fs";

test("every Premium product exposes one shared credit allowance", () => {
  assert.equal(subscriptionProductIds.weekly, "com.alangael.vesta.premium.weekly");
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.weekly), { credits: 150 });
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.monthly), { credits: 250 });
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.annual), { credits: 3_000 });
});

test("wardrobe additions and outfit generations spend from the same balance", () => {
  const usageServer = readFileSync(new URL("../lib/subscription-usage-server.ts", import.meta.url), "utf8");
  const usageRoute = readFileSync(new URL("../app/api/v1/subscription/usage/route.ts", import.meta.url), "utf8");
  const statusRoute = readFileSync(new URL("../app/api/v1/subscription/route.ts", import.meta.url), "utf8");
  const paywall = readFileSync(new URL("../mobile/SubscriptionPaywall.tsx", import.meta.url), "utf8");
  assert.match(usageServer, /const limit = allowances\.credits/u);
  assert.doesNotMatch(usageServer, /eq\(subscriptionUsage\.kind, kind\)/u);
  assert.match(usageRoute, /const limit = allowances\.credits/u);
  assert.doesNotMatch(usageRoute, /eq\(subscriptionUsage\.kind, body\.kind/u);
  assert.match(statusRoute, /allowances: allowances \? \{ credits: allowances\.credits \}/u);
  assert.match(paywall, /Créditos disponibles/u);
  assert.match(paywall, /Una prenda o una generación usa 1 crédito/u);
});

test("subscription verification rejects unsigned client claims", async () => {
  await assert.rejects(() => verifyAppleSubscription("not-an-apple-jws"), /apple_subscription_verification_failed/u);
});

test("free accounts see the upgrade flow before wardrobe and avatar actions", () => {
  const mobile = readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");
  const paywall = readFileSync(new URL("../mobile/SubscriptionPaywall.tsx", import.meta.url), "utf8");
  assert.match(mobile, /requirePremium\("wardrobe"\)/u);
  assert.match(mobile, /requirePremium\("try_on"\)/u);
  assert.match(mobile, /subscriptionStatus\?\.active/u);
  assert.match(paywall, /Añade prendas a tu armario/u);
  assert.match(paywall, /Mírate usando este outfit/u);
});
