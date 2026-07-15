import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
};

export function SubscriptionPaywall({ visible, onClose }: Props) {
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanId>("annual");
  const [purchasingProductId, setPurchasingProductId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [hasPremium, setHasPremium] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const [lastPurchase, setLastPurchase] = useState<Purchase | null>(null);
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
        }
        await finishTransaction({ purchase: lastPurchase, isConsumable: false });
        setHasPremium(true);
        setStoreMessage(null);
        Alert.alert("Outfit Club Premium activado", "Tu suscripción ya está lista en este iPhone.");
      } catch {
        processedTransactions.current.delete(transactionKey);
        setStoreMessage("La compra se recibió, pero no pudimos finalizarla. Usa Restaurar compras para reintentar.");
      } finally {
        setPurchasingProductId(null);
        setLastPurchase(null);
      }
    };

    finish().catch(() => undefined);
  }, [finishTransaction, lastPurchase, verifyPurchase]);

  const selected = subscriptionPlans.find((plan) => plan.id === selectedPlan)!;
  const selectedProduct = productsById.get(selected.productId);
  const canPurchase = connected && Boolean(selectedProduct) && !purchasingProductId;

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
      Alert.alert(
        active ? "Compra restaurada" : "Sin compras activas",
        active
          ? "Outfit Club Premium volvió a quedar activo en este iPhone."
          : "No encontramos una suscripción activa para este Apple ID.",
      );
    } catch {
      setStoreMessage("No pudimos restaurar tus compras. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
          <Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Cerrar planes Premium">
            <Text style={styles.closeText}>×</Text>
          </Pressable>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.crown}><Text style={styles.crownText}>OC</Text></View>
            <Text style={styles.eyebrow}>OUTFIT CLUB PREMIUM</Text>
            <Text style={styles.title}>Tu clóset, sin límites.</Text>
            <Text style={styles.intro}>Desbloquea la experiencia Premium y elige el ritmo que mejor te quede.</Text>

            {hasPremium && (
              <View style={styles.activePill}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>PREMIUM ACTIVO</Text>
              </View>
            )}

            <View style={styles.benefits}>
              <Text style={styles.benefit}>✓ Armario privado sincronizado</Text>
              <Text style={styles.benefit}>✓ Probador con tu avatar</Text>
              <Text style={styles.benefit}>✓ Looks guardados en tu cuenta</Text>
            </View>

            <View style={styles.planList}>
              {subscriptionPlans.map((plan) => {
                const product = productsById.get(plan.productId);
                const selectedNow = selectedPlan === plan.id;
                return (
                  <Pressable
                    key={plan.id}
                    style={[styles.planCard, selectedNow && styles.planCardSelected]}
                    onPress={() => setSelectedPlan(plan.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: selectedNow }}
                    accessibilityLabel={`${plan.title}, ${product?.displayPrice || "precio pendiente"} ${plan.cadence}`}
                  >
                    <View style={[styles.radio, selectedNow && styles.radioSelected]}>
                      {selectedNow && <View style={styles.radioDot} />}
                    </View>
                    <View style={styles.planCopy}>
                      <View style={styles.planHeading}>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                        {plan.badge && <Text style={styles.planBadge}>{plan.badge}</Text>}
                      </View>
                      <Text style={styles.planDescription}>{plan.description}</Text>
                    </View>
                    <View style={styles.priceCopy}>
                      <Text style={styles.price}>{product?.displayPrice || "—"}</Text>
                      <Text style={styles.cadence}>{product ? plan.cadence : "pendiente"}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {storeMessage && <Text style={styles.storeMessage}>{storeMessage}</Text>}
            {!connected && <Text style={styles.storeHint}>Conectando con el App Store…</Text>}
            {connected && !subscriptions.length && (
              <Text style={styles.storeHint}>Los precios aparecerán cuando los productos estén disponibles en App Store Connect.</Text>
            )}

            <Pressable
              style={[styles.purchaseButton, !canPurchase && styles.disabled]}
              onPress={() => purchaseSelectedPlan().catch(() => undefined)}
              disabled={!canPurchase}
            >
              {purchasingProductId
                ? <ActivityIndicator color="#FFF9EF" />
                : <Text style={styles.purchaseButtonText}>{selectedProduct ? `Suscribirme por ${selectedProduct.displayPrice}` : "Precio pendiente en App Store"}</Text>}
            </Pressable>

            <Pressable style={styles.linkButton} onPress={() => restore().catch(() => undefined)} disabled={restoring}>
              <Text style={styles.linkText}>{restoring ? "Restaurando…" : "Restaurar compras"}</Text>
            </Pressable>
            {hasPremium && (
              <Pressable style={styles.linkButton} onPress={() => deepLinkToSubscriptions().catch(() => undefined)}>
                <Text style={styles.linkText}>Administrar suscripción</Text>
              </Pressable>
            )}

            <Text style={styles.renewalCopy}>
              El pago se cargará a tu Apple ID al confirmar. La suscripción se renueva automáticamente salvo que la canceles al menos 24 horas antes de que termine el periodo actual. Puedes administrarla desde Ajustes del App Store.
            </Text>
            <View style={styles.legalRow}>
              <Pressable onPress={() => Linking.openURL(termsUrl).catch(() => undefined)}>
                <Text style={styles.legalLink}>Términos de uso</Text>
              </Pressable>
              <Text style={styles.legalSeparator}>·</Text>
              <Pressable onPress={() => setPrivacyOpen(true)}>
                <Text style={styles.legalLink}>Privacidad</Text>
              </Pressable>
              <Text style={styles.legalSeparator}>·</Text>
              <Text style={styles.legalNote}>{Platform.OS === "ios" ? "Pago seguro con Apple" : "Pago seguro"}</Text>
            </View>
          </ScrollView>
          </View>
        </View>
      </Modal>
      <PrivacyPolicyModal visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />
    </>
  );
}

const ink = "#211F1B";
const paper = "#F3EFE5";
const rust = "#A34F31";
const muted = "#777165";
const line = "#D8D1C4";

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.48)" },
  sheet: { maxHeight: "94%", overflow: "hidden", backgroundColor: paper, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  content: { paddingHorizontal: 20, paddingTop: 36, paddingBottom: 34 },
  closeButton: { position: "absolute", zIndex: 4, right: 14, top: 12, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.7)" },
  closeText: { color: ink, fontSize: 25, fontWeight: "300" },
  crown: { width: 54, height: 54, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 27, backgroundColor: ink },
  crownText: { color: paper, fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  eyebrow: { color: rust, textAlign: "center", fontSize: 8, fontWeight: "900", letterSpacing: 1.4, marginTop: 15 },
  title: { color: ink, textAlign: "center", fontSize: 34, lineHeight: 38, letterSpacing: -1.2, marginTop: 7, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  intro: { color: muted, maxWidth: 330, alignSelf: "center", textAlign: "center", fontSize: 10, lineHeight: 16, marginTop: 10 },
  activePill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, marginTop: 13, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, backgroundColor: "#E8EEE4" },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#607A58" },
  activeText: { color: "#607A58", fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  benefits: { marginTop: 19, gap: 7, padding: 13, borderRadius: 14, backgroundColor: "#F8F5ED" },
  benefit: { color: ink, fontSize: 9, lineHeight: 14, fontWeight: "600" },
  planList: { gap: 9, marginTop: 15 },
  planCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 82, padding: 12, borderWidth: 1, borderColor: line, borderRadius: 16, backgroundColor: "#F8F5ED" },
  planCardSelected: { borderWidth: 2, borderColor: rust, padding: 11, backgroundColor: "#F7EDE7" },
  radio: { width: 20, height: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#AAA194", borderRadius: 10 },
  radioSelected: { borderColor: rust },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: rust },
  planCopy: { flex: 1 },
  planHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  planTitle: { color: ink, fontSize: 12, fontWeight: "900" },
  planBadge: { color: "white", fontSize: 5, fontWeight: "900", letterSpacing: .6, paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8, backgroundColor: rust },
  planDescription: { color: muted, fontSize: 7, lineHeight: 11, marginTop: 5 },
  priceCopy: { alignItems: "flex-end", maxWidth: 92 },
  price: { color: ink, fontSize: 13, fontWeight: "900" },
  cadence: { color: muted, fontSize: 6, marginTop: 3 },
  storeMessage: { color: rust, textAlign: "center", fontSize: 8, lineHeight: 13, marginTop: 13 },
  storeHint: { color: muted, textAlign: "center", fontSize: 7, lineHeight: 12, marginTop: 13 },
  purchaseButton: { minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 16, paddingHorizontal: 16, borderRadius: 26, backgroundColor: ink },
  purchaseButtonText: { color: "#FFF9EF", fontSize: 10, fontWeight: "900" },
  disabled: { opacity: .5 },
  linkButton: { alignItems: "center", paddingVertical: 10 },
  linkText: { color: rust, fontSize: 8, fontWeight: "800", textDecorationLine: "underline" },
  renewalCopy: { color: muted, textAlign: "center", fontSize: 7, lineHeight: 12, marginTop: 5 },
  legalRow: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 12 },
  legalLink: { color: ink, fontSize: 7, textDecorationLine: "underline" },
  legalSeparator: { color: muted, fontSize: 7 },
  legalNote: { color: muted, fontSize: 7 },
});
