import assert from "node:assert/strict";
import test from "node:test";
import { allowancesForProduct, subscriptionProductIds } from "../lib/subscription-plans.ts";
import { verifyAppleSubscription } from "../lib/apple-subscription.ts";
import { readFileSync } from "node:fs";

test("weekly Premium exposes the commercial limits enforced by the backend", () => {
  assert.equal(subscriptionProductIds.weekly, "com.alangael.vesta.premium.weekly");
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.weekly), { wardrobeAddition: 50, lookGeneration: 150 });
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.monthly), { wardrobeAddition: 100, lookGeneration: 250 });
  assert.deepEqual(allowancesForProduct(subscriptionProductIds.annual), { wardrobeAddition: 1_200, lookGeneration: 3_000 });
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
