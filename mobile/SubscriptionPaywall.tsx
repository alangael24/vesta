import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  deepLinkToSubscriptions,
  ErrorCode,
  Purchase,
  useIAP,
} from "react-native-iap";
import {
  SubscriptionPlanId,
  subscriptionPlans,
  subscriptionProductIdList,
} from "./subscriptions";
import { PrivacyPolicyModal } from "./PrivacyPolicy";

const termsUrl = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

type Props = {
  visible: boolean;
  onClose: () => void;
  onStatusChange?: (status: SubscriptionStatus) => void;
  reason?: "wardrobe" | "try_on" | "looks" | null;
  cloud?: {
    apiUrl: string;
    dispatchToken: string;
    deviceToken: string;
  } | null;
};

export type SubscriptionStatus = {
  active: boolean;
  allowances?: { wardrobeAdditions: number; lookGenerations: number } | null;
  usage?: { wardrobeAdditions: number; lookGenerations: number } | null;
};

export function SubscriptionPaywall({ visible, onClose, onStatusChange, reason, cloud }: Props) {
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanId>("annual");
  const [purchasingProductId, setPurchasingProductId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [hasPremium, setHasPremium] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const [lastPurchase, setLastPurchase] = useState<Purchase | null>(null);
  const [serverStatus, setServerStatus] = useState<SubscriptionStatus | null>(null);
  const processedTransactions = useRef(new Set<string>());

  const {
    connected,
    subscriptions,
    fetchProducts,
    finishTransaction,
    hasActiveSubscriptions,
    requestPurchase,
    restorePurchases,
    verifyPurchase,
  } = useIAP({
    onPurchaseSuccess: (purchase) => setLastPurchase(purchase),
    onPurchaseError: (error) => {
      setPurchasingProductId(null);
      if (error.code !== ErrorCode.UserCancelled) {
        setStoreMessage("No se pudo completar la compra. Inténtalo de nuevo.");
      }
    },
    onError: () => setStoreMessage("No pudimos conectarnos al App Store en este momento."),
  });

  const productsById = useMemo(
    () => new Map(subscriptions.map((subscription) => [subscription.id, subscription])),
    [subscriptions],
  );

  useEffect(() => {
    if (!connected) return;
    setStoreMessage(null);
    fetchProducts({ skus: subscriptionProductIdList, type: "subs" }).catch(() => undefined);
    hasActiveSubscriptions(subscriptionProductIdList).then(setHasPremium).catch(() => undefined);
  }, [connected, fetchProducts, hasActiveSubscriptions]);

  useEffect(() => {
    if (!visible || !connected) return;
    hasActiveSubscriptions(subscriptionProductIdList).then(setHasPremium).catch(() => undefined);
  }, [visible, connected, hasActiveSubscriptions]);

  useEffect(() => {
    if (!visible || !cloud) return;
    fetch(`${cloud.apiUrl}/api/v1/subscription`, {
      headers: {
        "OAI-Sites-Authorization": `Bearer ${cloud.dispatchToken}`,
        "x-vesta-device-token": cloud.deviceToken,
      },
    }).then(async (response) => {
      if (response.ok) {
        const status = await response.json() as SubscriptionStatus;
        setServerStatus(status);
        onStatusChange?.(status);
      }
    }).catch(() => undefined);
  }, [cloud, visible]);

  useEffect(() => {
    if (!lastPurchase) return;
    const transactionKey = lastPurchase.transactionId || lastPurchase.id;
    if (processedTransactions.current.has(transactionKey)) return;
    processedTransactions.current.add(transactionKey);

    const finish = async () => {
      try {
        if (!subscriptionProductIdList.includes(lastPurchase.productId)) {
          throw new Error("unexpected_subscription_product");
        }
        if (Platform.OS === "ios") {
          const verification = await verifyPurchase({ apple: { sku: lastPurchase.productId } });
          if (!("isValid" in verification) || !verification.isValid) {
            throw new Error("subscription_verification_failed");
          }
          if (!lastPurchase.purchaseToken) throw new Error("signed_transaction_missing");
          if (!cloud) throw new Error("private_account_not_connected");
          const response = await fetch(`${cloud.apiUrl}/api/v1/subscription`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "OAI-Sites-Authorization": `Bearer ${cloud.dispatchToken}`,
              "x-vesta-device-token": cloud.deviceToken,
            },
            body: JSON.stringify({ signedTransaction: lastPurchase.purchaseToken }),
          });
          if (!response.ok) throw new Error("server_subscription_verification_failed");
          const status = await response.json() as SubscriptionStatus;
          setServerStatus(status);
          onStatusChange?.(status);
        }
        await finishTransaction({ purchase: lastPurchase, isConsumable: false });
        setHasPremium(true);
        setStoreMessage(null);
        setStoreMessage("Outfit Club Premium ya está activo en este iPhone.");
      } catch {
        processedTransactions.current.delete(transactionKey);
        setStoreMessage("La compra se recibió, pero no pudimos finalizarla. Usa Restaurar compras para reintentar.");
      } finally {
        setPurchasingProductId(null);
        setLastPurchase(null);
      }
    };

    finish().catch(() => undefined);
  }, [cloud, finishTransaction, lastPurchase, verifyPurchase]);

  const selected = subscriptionPlans.find((plan) => plan.id === selectedPlan)!;
  const selectedProduct = productsById.get(selected.productId);
  const canPurchase = connected && Boolean(selectedProduct) && !purchasingProductId;
  const selectedSubtitle = selectedPlan === "weekly"
    ? "Flexibilidad para probar tu estilo"
    : selectedPlan === "monthly"
      ? "Tu clóset creativo, mes a mes"
      : "La mejor forma de vestir todo el año";

  async function purchaseSelectedPlan() {
    if (!selectedProduct || !canPurchase) return;
    setStoreMessage(null);
    setPurchasingProductId(selected.productId);
    try {
      await requestPurchase({
        request: {
          apple: { sku: selected.productId },
          google: { skus: [selected.productId] },
        },
        type: "subs",
      });
    } catch {
      setPurchasingProductId(null);
      setStoreMessage("No se pudo abrir la compra del App Store.");
    }
  }

  async function restore() {
    setRestoring(true);
    setStoreMessage(null);
    try {
      await restorePurchases();
      const active = await hasActiveSubscriptions(subscriptionProductIdList);
      setHasPremium(active);
      setStoreMessage(active
        ? "Compra restaurada. Outfit Club Premium está activo."
        : "No encontramos una suscripción activa para este Apple ID.");
    } catch {
      setStoreMessage("No pudimos restaurar tus compras. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={styles.screen}>
          <View style={styles.hero}>
            <View style={styles.heroGlow} />
            <View style={styles.lookCardBack} />
            <View style={styles.lookCardFront}>
              <Text style={styles.lookMonogram}>OC</Text>
              <View style={styles.lookLine} />
              <View style={[styles.lookLine, styles.lookLineShort]} />
            </View>
            <Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Cerrar planes Premium">
              <Text style={styles.closeText}>×</Text>
            </Pressable>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>OUTFIT CLUB</Text>
              <Text style={styles.title}>Premium</Text>
              <Text style={styles.intro}>{selectedSubtitle}</Text>
            </View>
          </View>

          <View style={styles.segmentWrap} accessibilityRole="radiogroup">
            {subscriptionPlans.map((plan) => {
              const selectedNow = selectedPlan === plan.id;
              return (
                <Pressable key={plan.id} style={[styles.segment, selectedNow && styles.segmentSelected]}
                  onPress={() => setSelectedPlan(plan.id)} accessibilityRole="radio"
                  accessibilityState={{ selected: selectedNow }} accessibilityLabel={`Plan ${plan.title}`}>
                  <Text style={[styles.segmentText, selectedNow && styles.segmentTextSelected]}>{plan.title}</Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
            {reason && (
              <View style={styles.unlockCard}>
                <Text style={styles.unlockEyebrow}>DESBLOQUEA ESTA FUNCIÓN</Text>
                <Text style={styles.unlockTitle}>{reason === "wardrobe"
                  ? "Añade prendas a tu armario"
                  : reason === "try_on"
                    ? "Mírate usando este outfit"
                    : "Crea nuevas fotos para tus Looks"}</Text>
                <Text style={styles.unlockCopy}>Elige un plan para continuar. Lo que ya guardaste seguirá disponible.</Text>
              </View>
            )}
            {hasPremium && (
              <View style={styles.activePill}><View style={styles.activeDot} /><Text style={styles.activeText}>PREMIUM ACTIVO EN ESTE IPHONE</Text></View>
            )}
            {serverStatus?.active && serverStatus.allowances && serverStatus.usage && (
              <View style={styles.quotaCard}>
                <View style={styles.quotaRow}>
                  <Text style={styles.quotaLabel}>Prendas disponibles</Text>
                  <Text style={styles.quotaValue}>{Math.max(0, serverStatus.allowances.wardrobeAdditions - serverStatus.usage.wardrobeAdditions)} de {serverStatus.allowances.wardrobeAdditions}</Text>
                </View>
                <View style={styles.quotaRow}>
                  <Text style={styles.quotaLabel}>Looks disponibles</Text>
                  <Text style={styles.quotaValue}>{Math.max(0, serverStatus.allowances.lookGenerations - serverStatus.usage.lookGenerations)} de {serverStatus.allowances.lookGenerations}</Text>
                </View>
                <Text style={styles.quotaNote}>Abrir Looks guardados no consume unidades.</Text>
              </View>
            )}
            {selected.benefits.map((benefit) => (
              <View style={styles.benefitRow} key={benefit}>
                <View style={styles.checkCircle}><Text style={styles.check}>✓</Text></View>
                <Text style={styles.benefit}>{benefit}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <View style={styles.selectedPlanCard}>
              <View style={styles.selectedRadio}><Text style={styles.selectedCheck}>✓</Text></View>
              <View style={styles.selectedPlanCopy}>
                <Text style={styles.selectedPlanTitle}>Plan {selected.title}</Text>
                <Text style={styles.selectedPlanDescription}>{selected.description}</Text>
              </View>
              <View style={styles.priceCopy}>
                <Text style={styles.price}>{selectedProduct?.displayPrice || "—"}</Text>
                <Text style={styles.cadence}>{selectedProduct ? selected.cadence : "precio pendiente"}</Text>
              </View>
              {selected.badge && <Text style={styles.planBadge}>{selected.badge}</Text>}
            </View>
            {storeMessage && <Text style={styles.storeMessage}>{storeMessage}</Text>}
            {!connected && <Text style={styles.storeHint}>Conectando con el App Store…</Text>}
            {connected && !subscriptions.length && <Text style={styles.storeHint}>Los precios aparecerán cuando App Store Connect los entregue.</Text>}
            <Pressable style={[styles.purchaseButton, !canPurchase && styles.disabled]}
              onPress={() => purchaseSelectedPlan().catch(() => undefined)} disabled={!canPurchase}>
              {purchasingProductId ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.purchaseButtonText}>{selectedProduct ? "Continuar" : "Precio pendiente en App Store"}</Text>}
            </Pressable>
            <Text style={styles.cancelCopy}>Cancela en cualquier momento.</Text>
            <View style={styles.helpRow}>
              <Pressable onPress={() => restore().catch(() => undefined)} disabled={restoring}>
                <Text style={styles.helpLink}>{restoring ? "Restaurando…" : "Restaurar compras"}</Text>
              </Pressable>
              {hasPremium && <Pressable onPress={() => deepLinkToSubscriptions().catch(() => undefined)}><Text style={styles.helpLink}>Administrar</Text></Pressable>}
            </View>
            <Text style={styles.renewalCopy}>La suscripción se renueva automáticamente salvo cancelación al menos 24 horas antes del fin del periodo.</Text>
            <View style={styles.legalRow}>
              <Pressable onPress={() => Linking.openURL(termsUrl).catch(() => undefined)}><Text style={styles.legalLink}>Términos</Text></Pressable>
              <Text style={styles.legalSeparator}>·</Text>
              <Pressable onPress={() => setPrivacyOpen(true)}><Text style={styles.legalLink}>Privacidad</Text></Pressable>
              <Text style={styles.legalSeparator}>·</Text>
              <Text style={styles.legalNote}>{Platform.OS === "ios" ? "Pago seguro con Apple" : "Pago seguro"}</Text>
            </View>
          </View>
        </View>
      </Modal>
      <PrivacyPolicyModal visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </>
  );
}

const ink = "#F7F2E9";
const night = "#0D0E10";
const panel = "#1B1D21";
const violet = "#7567FF";
const muted = "#A7A8AD";
const line = "#34363C";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: night, paddingTop: Platform.OS === "ios" ? 48 : 20 },
  hero: { height: 250, marginHorizontal: 8, overflow: "hidden", borderRadius: 34, backgroundColor: "#392C55" },
  heroGlow: { position: "absolute", width: 310, height: 310, borderRadius: 155, right: -80, top: -100, backgroundColor: "#BC7E74", opacity: .78 },
  lookCardBack: { position: "absolute", right: 32, top: 52, width: 112, height: 142, borderRadius: 17, backgroundColor: "#1A1618", opacity: .75, transform: [{ rotate: "8deg" }] },
  lookCardFront: { position: "absolute", right: 55, top: 40, width: 112, height: 145, padding: 16, borderRadius: 17, backgroundColor: "#E8D0BF", transform: [{ rotate: "-5deg" }] },
  lookMonogram: { color: "#241C1A", fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 28, fontWeight: "700" },
  lookLine: { width: 62, height: 5, borderRadius: 3, marginTop: 46, backgroundColor: "#9A5B47" },
  lookLineShort: { width: 42, marginTop: 7, opacity: .5 },
  closeButton: { position: "absolute", zIndex: 4, right: 16, top: 16, width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(20,20,24,.58)" },
  closeText: { color: "#FFF", fontSize: 40, lineHeight: 44, fontWeight: "200" },
  heroCopy: { position: "absolute", left: 28, bottom: 43, maxWidth: "60%" },
  eyebrow: { color: "#E9B9A8", fontSize: 11, fontWeight: "900", letterSpacing: 2 },
  title: { color: "#FFF", fontSize: 36, lineHeight: 40, letterSpacing: -.8, marginTop: 6, fontWeight: "800" },
  intro: { color: "#F4EDE9", fontSize: 17, lineHeight: 23, marginTop: 8 },
  segmentWrap: { zIndex: 5, height: 64, flexDirection: "row", alignItems: "center", marginHorizontal: 44, marginTop: -32, padding: 7, borderRadius: 32, backgroundColor: "#4B3A77" },
  segment: { flex: 1, height: 50, alignItems: "center", justifyContent: "center", borderRadius: 25 },
  segmentSelected: { backgroundColor: "#17151C" },
  segmentText: { color: "#E7E1F1", fontSize: 16, fontWeight: "700" },
  segmentTextSelected: { color: "#FFF" },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 24, gap: 16 },
  unlockCard: { padding: 16, borderWidth: 1, borderColor: "#514892", borderRadius: 17, backgroundColor: "#191727" },
  unlockEyebrow: { color: "#9B91FF", fontSize: 9, fontWeight: "900", letterSpacing: 1.1 },
  unlockTitle: { color: ink, fontSize: 18, lineHeight: 23, fontWeight: "800", marginTop: 6 },
  unlockCopy: { color: muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  activePill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "#17241E" },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#71B78D" },
  activeText: { color: "#8DD0A6", fontSize: 9, fontWeight: "900", letterSpacing: .7 },
  quotaCard: { padding: 15, borderWidth: 1, borderColor: line, borderRadius: 16, backgroundColor: panel },
  quotaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 4 },
  quotaLabel: { color: ink, fontSize: 13, fontWeight: "700" },
  quotaValue: { color: "#BEB6FF", fontSize: 13, fontWeight: "900" },
  quotaNote: { color: muted, fontSize: 11, marginTop: 8 },
  benefitRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 14 },
  checkCircle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#26232F" },
  check: { color: violet, fontSize: 27, fontWeight: "700" },
  benefit: { flex: 1, color: ink, fontSize: 17, lineHeight: 23, fontWeight: "600" },
  footer: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: Platform.OS === "ios" ? 22 : 16, borderTopWidth: 1, borderTopColor: line, backgroundColor: night },
  selectedPlanCard: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderWidth: 2, borderColor: violet, borderRadius: 18, backgroundColor: panel },
  selectedRadio: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: violet },
  selectedCheck: { color: "#FFF", fontSize: 20, fontWeight: "800" },
  selectedPlanCopy: { flex: 1 },
  selectedPlanTitle: { color: ink, fontSize: 15, fontWeight: "800" },
  selectedPlanDescription: { color: muted, fontSize: 10, lineHeight: 14, marginTop: 4 },
  planBadge: { position: "absolute", right: 10, top: -11, overflow: "hidden", color: "white", fontSize: 9, fontWeight: "900", letterSpacing: .4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, backgroundColor: violet },
  priceCopy: { alignItems: "flex-end", maxWidth: 90 },
  price: { color: ink, fontSize: 17, fontWeight: "900" },
  cadence: { color: muted, fontSize: 9, marginTop: 4 },
  storeMessage: { color: "#F19B7E", textAlign: "center", fontSize: 11, lineHeight: 15, marginTop: 8 },
  storeHint: { color: muted, textAlign: "center", fontSize: 10, lineHeight: 14, marginTop: 8 },
  purchaseButton: { minHeight: 58, alignItems: "center", justifyContent: "center", marginTop: 14, paddingHorizontal: 16, borderRadius: 29, backgroundColor: violet },
  purchaseButtonText: { color: "#FFF", fontSize: 18, fontWeight: "800" },
  disabled: { opacity: .5 },
  cancelCopy: { color: muted, textAlign: "center", fontSize: 11, marginTop: 12 },
  helpRow: { flexDirection: "row", justifyContent: "center", gap: 20, marginTop: 7 },
  helpLink: { color: "#9B91FF", fontSize: 11, fontWeight: "700", textDecorationLine: "underline" },
  renewalCopy: { color: "#74767D", textAlign: "center", fontSize: 8, lineHeight: 11, marginTop: 8 },
  legalRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 7 },
  legalLink: { color: muted, fontSize: 9, textDecorationLine: "underline" },
  legalSeparator: { color: "#66686E", fontSize: 9 },
  legalNote: { color: muted, fontSize: 9 },
});
