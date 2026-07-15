import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type ViewName = "closet" | "builder" | "looks";
type Category = "all" | "tops" | "layers" | "bottoms" | "accessories";
type ItemId = number | string;

type WardrobeItem = {
  id: ItemId;
  name: string;
  category: Exclude<Category, "all">;
  type: string;
  color: string;
  material?: string;
  description?: string;
  confidence?: number | null;
  status?: string;
  reconstructionQuality?: "draft" | "final" | null;
  transparentPixelRatio?: number | null;
  qaStatus?: "pending" | "pass" | "review" | "fail" | null;
  qaSummary?: { summary?: string | null; issues?: string[] };
  imagePath?: string | null;
  imageKind?: "cutout" | "evidence";
  spriteIndex?: number;
};

type Outfit = {
  id: number;
  name: string;
  occasion: string;
  note: string;
};

type CloudSession = {
  apiUrl: string;
  dispatchToken: string;
  deviceToken: string;
  deviceId: string;
};

type CloudGarment = {
  id: string;
  name: string;
  category: string;
  type: string;
  color: string;
  material?: string;
  description?: string;
  confidence?: number | null;
  status?: string;
  reconstructionQuality?: "draft" | "final" | null;
  transparentPixelRatio?: number | null;
  qaStatus?: "pending" | "pass" | "review" | "fail" | null;
  qaSummary?: { summary?: string | null; issues?: string[] };
  imagePath?: string | null;
  imageKind?: "cutout" | "evidence";
};

const cloudKeys = {
  apiUrl: "vesta.api-url",
  dispatchToken: "vesta.dispatch-token",
  deviceToken: "vesta.device-token",
  deviceId: "vesta.device-id",
};

const wardrobeSprite = require("./assets/wardrobe-sprite.png") as ImageSourcePropType;
const outfitSprite = require("./assets/outfit-sprite.png") as ImageSourcePropType;

const wardrobe: WardrobeItem[] = [
  { id: 0, spriteIndex: 0, name: "Camiseta negra", category: "tops", type: "Camiseta", color: "Negro" },
  { id: 1, spriteIndex: 1, name: "Polo marino", category: "tops", type: "Polo", color: "Azul marino" },
  { id: 2, spriteIndex: 2, name: "Camiseta cruda", category: "tops", type: "Camiseta", color: "Crudo" },
  { id: 3, spriteIndex: 3, name: "Oxford celeste", category: "tops", type: "Camisa", color: "Azul claro" },
  { id: 4, spriteIndex: 4, name: "Sobrecamisa cuadro", category: "layers", type: "Sobrecamisa", color: "Azul" },
  { id: 5, spriteIndex: 5, name: "Polo tejido", category: "tops", type: "Polo", color: "Arena" },
  { id: 6, spriteIndex: 6, name: "Jersey avena", category: "layers", type: "Jersey", color: "Avena" },
  { id: 7, spriteIndex: 7, name: "Chaqueta denim", category: "layers", type: "Chaqueta", color: "Índigo" },
  { id: 8, spriteIndex: 8, name: "Field jacket", category: "layers", type: "Chaqueta", color: "Oliva" },
  { id: 9, spriteIndex: 9, name: "Pantalón óxido", category: "bottoms", type: "Pantalón", color: "Óxido" },
  { id: 10, spriteIndex: 10, name: "Chino arena", category: "bottoms", type: "Chino", color: "Arena" },
  { id: 11, spriteIndex: 11, name: "Pantalón cacao", category: "bottoms", type: "Pantalón", color: "Cacao" },
  { id: 12, spriteIndex: 12, name: "Jean lavado", category: "bottoms", type: "Jeans", color: "Azul claro" },
  { id: 13, spriteIndex: 13, name: "Short negro", category: "bottoms", type: "Short", color: "Negro" },
  { id: 14, spriteIndex: 14, name: "Gorra camel", category: "accessories", type: "Gorra", color: "Camel" },
  { id: 15, spriteIndex: 15, name: "Gafas negras", category: "accessories", type: "Gafas", color: "Negro" },
];

const outfits: Outfit[] = [
  { id: 0, name: "Oliva & óxido", occasion: "Tarde casual", note: "Tonos terrosos con una base clara para mantener el look fresco." },
  { id: 1, name: "Marino mediterráneo", occasion: "Comida", note: "Contraste limpio entre azul profundo y arena." },
  { id: 2, name: "Negro & cacao", occasion: "Cena", note: "Dos tonos profundos con texturas distintas." },
  { id: 3, name: "Azul de verano", occasion: "Fin de semana", note: "Una combinación ligera y relajada." },
  { id: 4, name: "Avena & denim", occasion: "Café", note: "Suave, equilibrado y perfecto para una mañana fresca." },
  { id: 5, name: "Capas suaves", occasion: "Trabajo flexible", note: "Patrón y neutros con suficiente espacio para respirar." },
  { id: 6, name: "Denim ligero", occasion: "Viaje", note: "Una fórmula fácil para cambios de clima." },
  { id: 7, name: "Punto cálido", occasion: "Atardecer", note: "Textura cálida con un acento de color terroso." },
];

const filters: { id: Category; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "tops", label: "Arriba" },
  { id: "layers", label: "Capas" },
  { id: "bottoms", label: "Abajo" },
  { id: "accessories", label: "Accesorios" },
];

const occasions = ["Diario", "Trabajo", "Cena", "Viaje"];

function Sprite({
  source,
  index,
  columns,
  rows,
  aspectRatio = 1,
}: {
  source: ImageSourcePropType;
  index: number;
  columns: number;
  rows: number;
  aspectRatio?: number;
}) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const column = index % columns;
  const row = Math.floor(index / columns);
  const onLayout = (event: LayoutChangeEvent) => setLayout(event.nativeEvent.layout);

  return (
    <View style={[styles.spriteFrame, { aspectRatio }]} onLayout={onLayout}>
      {layout.width > 0 && (
        <Image
          source={source}
          resizeMode="stretch"
          style={{
            position: "absolute",
            width: layout.width * columns,
            height: layout.height * rows,
            left: -column * layout.width,
            top: -row * layout.height,
          }}
        />
      )}
    </View>
  );
}

function GarmentVisual({ item, session }: { item: WardrobeItem; session: CloudSession | null }) {
  if (item.imagePath && session) {
    return (
      <View style={[styles.spriteFrame, { aspectRatio: 1 }]}>
        <Image source={authorizedImageSource(session, item.imagePath)} resizeMode={item.imageKind === "cutout" ? "contain" : "cover"} style={styles.cloudGarmentImage} />
        {item.imageKind === "evidence" && <View style={styles.evidenceBadge}><Text style={styles.evidenceBadgeText}>EVIDENCIA</Text></View>}
      </View>
    );
  }
  return <Sprite source={wardrobeSprite} index={item.spriteIndex ?? Number(item.id)} columns={4} rows={4} />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [view, setView] = useState<ViewName>("closet");
  const [filter, setFilter] = useState<Category>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [batchReady, setBatchReady] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [reconstructingId, setReconstructingId] = useState<ItemId | null>(null);
  const [cloudWardrobe, setCloudWardrobe] = useState<WardrobeItem[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [wardrobeLoading, setWardrobeLoading] = useState(false);
  const [builderItems, setBuilderItems] = useState<ItemId[]>([2, 9]);
  const [occasion, setOccasion] = useState("Diario");

  const activeWardrobe = cloudWardrobe.length ? cloudWardrobe : wardrobe;

  const visibleItems = useMemo(
    () => activeWardrobe.filter((item) => filter === "all" || item.category === filter),
    [activeWardrobe, filter],
  );
  const photoBytes = useMemo(
    () => photos.reduce((total, photo) => total + (photo.fileSize ?? 0), 0),
    [photos],
  );

  async function redeemPairingUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== "vesta:" || parsed.hostname !== "pair") return;
    const apiUrl = parsed.searchParams.get("api")?.replace(/\/$/u, "");
    const dispatchToken = parsed.searchParams.get("dispatch");
    const code = parsed.searchParams.get("code");
    if (!apiUrl || !dispatchToken || !code) return;

    setPairing(true);
    setProfileOpen(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/pairing/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OAI-Sites-Authorization": `Bearer ${dispatchToken}`,
        },
        body: JSON.stringify({
          code,
          name: Device.deviceName || (Platform.OS === "ios" ? "iPhone de Alan" : "Android de Alan"),
          platform: Platform.OS,
        }),
      });
      if (!response.ok) throw new Error("pairing_failed");
      const result = await response.json() as { deviceToken: string; deviceId: string };
      const session = { apiUrl, dispatchToken, deviceToken: result.deviceToken, deviceId: result.deviceId };
      await Promise.all([
        SecureStore.setItemAsync(cloudKeys.apiUrl, session.apiUrl),
        SecureStore.setItemAsync(cloudKeys.dispatchToken, session.dispatchToken),
        SecureStore.setItemAsync(cloudKeys.deviceToken, session.deviceToken),
        SecureStore.setItemAsync(cloudKeys.deviceId, session.deviceId),
      ]);
      setCloudSession(session);
      Alert.alert("Nube conectada", "Este teléfono ya puede guardar fotos en tu nube privada de Vesta.");
    } catch {
      Alert.alert("No se pudo emparejar", "El enlace pudo expirar. Genera uno nuevo desde la web privada.");
    } finally {
      setPairing(false);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      SecureStore.getItemAsync(cloudKeys.apiUrl),
      SecureStore.getItemAsync(cloudKeys.dispatchToken),
      SecureStore.getItemAsync(cloudKeys.deviceToken),
      SecureStore.getItemAsync(cloudKeys.deviceId),
    ]).then(([apiUrl, dispatchToken, deviceToken, deviceId]) => {
      if (active && apiUrl && dispatchToken && deviceToken && deviceId) {
        setCloudSession({ apiUrl, dispatchToken, deviceToken, deviceId });
      }
    }).catch(() => undefined);

    const subscription = Linking.addEventListener("url", ({ url }) => redeemPairingUrl(url));
    Linking.getInitialURL().then((url) => {
      if (url) return redeemPairingUrl(url);
      return undefined;
    }).catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!cloudSession) {
      setCloudWardrobe([]);
      return;
    }
    loadWardrobe(cloudSession).catch(() => undefined);
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken]);

  async function loadWardrobe(session = cloudSession) {
    if (!session) return;
    setWardrobeLoading(true);
    try {
      const response = await cloudFetch(session, "/api/v1/wardrobe", { method: "GET" });
      if (!response.ok) return;
      const result = await response.json() as { garments: CloudGarment[]; duplicateCount?: number };
      const items = result.garments.map((item) => ({
        ...item,
        category: categoryForUi(item.category),
      }));
      setCloudWardrobe(items);
      setDuplicateCount(result.duplicateCount ?? 0);
      return items;
    } finally {
      setWardrobeLoading(false);
    }
  }

  const pickPhotos = async () => {
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permiso necesario", "Vesta solo puede ver las fotos que tú selecciones. Activa el permiso para continuar.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 40,
        quality: 1,
        exif: false,
        base64: false,
      });
      if (!result.canceled) {
        setPhotos(result.assets);
        setBatchReady(false);
      }
    } finally {
      setPicking(false);
    }
  };

  const prepareBatch = () => {
    setBatchReady(true);
    setImportOpen(false);
    Alert.alert("Lote local preparado", "Tus fotos siguen únicamente en este teléfono hasta que pulses “Subir a mi nube privada”.");
  };

  const disconnectCloud = async () => {
    await Promise.all(Object.values(cloudKeys).map((key) => SecureStore.deleteItemAsync(key)));
    setCloudSession(null);
  };

  const pairFromClipboard = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (!value.startsWith("vesta://pair?")) {
      Alert.alert("No hay un enlace de Vesta", "Copia el enlace desde la web privada y vuelve a intentarlo.");
      return;
    }
    await redeemPairingUrl(value);
  };

  const uploadBatch = async () => {
    if (!cloudSession) {
      setImportOpen(false);
      setProfileOpen(true);
      return;
    }
    if (photos.some((photo) => !photo.fileSize)) {
      Alert.alert("No se pudo leer el tamaño", "Vuelve a elegir estas fotos para preparar una subida segura.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const manifest = photos.map((photo, index) => ({
        filename: photo.fileName || `foto-${index + 1}.${extensionFor(photo)}`,
        contentType: mimeTypeFor(photo),
        sizeBytes: photo.fileSize,
        width: photo.width,
        height: photo.height,
      }));
      const batchResponse = await cloudFetch(cloudSession, "/api/v1/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: manifest, originalsPolicy: "retain_private" }),
      });
      if (!batchResponse.ok) throw new Error("batch_failed");
      const batch = await batchResponse.json() as { batchId: string; photos: Array<{ uploadPath: string }> };

      for (let index = 0; index < photos.length; index += 1) {
        const fileResponse = await fetch(photos[index].uri);
        const blob = await fileResponse.blob();
        const uploadResponse = await cloudFetch(cloudSession, batch.photos[index].uploadPath, {
          method: "PUT",
          headers: { "Content-Type": manifest[index].contentType },
          body: blob,
        });
        if (!uploadResponse.ok) throw new Error("upload_failed");
        setUploadProgress(Math.round(((index + 1) / photos.length) * 100));
      }

      setBatchReady(false);
      setImportOpen(false);
      const uploadedCount = photos.length;
      setPhotos([]);
      Alert.alert(
        "Fotos guardadas en tu nube",
        `${uploadedCount} fotos ya están privadas en Vesta. Para detectar prendas se enviarán copias reducidas a la API de OpenAI. No se usan para entrenar por defecto; sus registros de seguridad pueden conservarse hasta 30 días. ¿Qué prefieres?`,
        [
          { text: "Analizar después", style: "cancel" },
          { text: "Económico", onPress: () => startProcessing(batch.batchId, "economy") },
          { text: "Máxima precisión", onPress: () => startProcessing(batch.batchId, "quality") },
        ],
      );
    } catch {
      Alert.alert("La subida se interrumpió", "Tus fotos locales siguen intactas. Puedes intentarlo otra vez.");
    } finally {
      setUploading(false);
    }
  };

  const startProcessing = async (batchId: string, mode: "economy" | "quality") => {
    if (!cloudSession || processing) return;
    setProcessing(true);
    try {
      const response = await cloudFetch(cloudSession, `/api/v1/batches/${batchId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, consent: true, acknowledgesOpenAIRetention: true }),
      });
      const result = await response.json() as { error?: string; garmentCount?: number; duplicateCount?: number; deduplicationStatus?: string };
      if (response.status === 503 && result.error === "processing_not_configured") {
        Alert.alert("Fotos seguras; análisis pendiente", "El motor privado de IA todavía necesita su clave de procesamiento. Tus fotos quedaron guardadas y no se enviaron a OpenAI.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "processing_failed");
      await loadWardrobe(cloudSession);
      const dedupCopy = result.deduplicationStatus === "failed" ? "La revisión de duplicados queda pendiente." : `${result.duplicateCount ?? 0} duplicados de alta confianza quedaron apartados.`;
      Alert.alert("Inventario listo para revisar", `Vesta detectó ${result.garmentCount ?? 0} candidatos de prendas. ${dedupCopy}`);
    } catch {
      Alert.alert("El análisis no terminó", "Tus originales siguen seguros en la nube. Podremos reintentar el inventario sin volver a subirlos.");
    } finally {
      setProcessing(false);
    }
  };

  const chooseReconstruction = (item: WardrobeItem) => {
    const heldNote = item.status === "held" ? " La evidencia es débil; si continúas, el resultado quedará obligado a revisión." : "";
    Alert.alert(
      "Crear PNG transparente",
      `Esta operación reconstruye una sola prenda con GPT Image 2 y después verifica el resultado contra tus fotos.${heldNote}`,
      [
        { text: "Ahora no", style: "cancel" },
        { text: "Borrador económico", onPress: () => startReconstruction(item, "draft") },
        { text: "Calidad final", onPress: () => startReconstruction(item, "final") },
      ],
    );
  };

  const startReconstruction = async (item: WardrobeItem, mode: "draft" | "final") => {
    if (!cloudSession || reconstructingId) return;
    setReconstructingId(item.id);
    try {
      const response = await cloudFetch(cloudSession, `/api/v1/garments/${item.id}/reconstruct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          consent: true,
          acknowledgesOpenAIRetention: true,
          forceHeld: item.status === "held",
        }),
      });
      const result = await response.json() as { error?: string; status?: string; qaStatus?: string };
      if (response.status === 503 && result.error === "processing_not_configured") {
        Alert.alert("PNG pendiente", "La clave de procesamiento todavía no está conectada. No se generó ningún cargo ni se enviaron imágenes.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "reconstruction_failed");
      const items = await loadWardrobe(cloudSession);
      const refreshed = items?.find((entry) => entry.id === item.id);
      if (refreshed) setSelectedItem(refreshed);
      if (result.status === "approved") {
        Alert.alert("PNG verificado", "La reconstrucción pasó las comprobaciones técnicas y visuales.");
      } else {
        Alert.alert("Necesita revisión", "Vesta conservó la evidencia y marcó el resultado para revisión en lugar de aprobarlo automáticamente.");
      }
    } catch {
      Alert.alert("No se creó el PNG", "La prenda y sus fotos siguen intactas. Puedes reintentar sin volver a subirlas.");
    } finally {
      setReconstructingId(null);
    }
  };

  const toggleBuilderItem = (id: ItemId) => {
    setBuilderItems((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 3) return [...current.slice(1), id];
      return [...current, id];
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        <View style={styles.topbar}>
          <Pressable onPress={() => setView("closet")} style={styles.brand} accessibilityLabel="Ir al armario">
            <View style={styles.brandMark}><Text style={styles.brandLetter}>V</Text></View>
            <Text style={styles.brandName}>VESTA</Text>
          </Pressable>
          <View style={styles.cloudBadge}>
            <View style={cloudSession ? styles.greenDot : styles.rustDot} />
            <Text style={[styles.cloudBadgeText, !cloudSession && styles.cloudBadgePending]}>{processing ? "ANALIZANDO…" : reconstructingId ? "CREANDO PNG…" : cloudSession ? "NUBE CONECTADA" : "NUBE POR EMPAREJAR"}</Text>
          </View>
          <Pressable style={styles.avatar} onPress={() => setProfileOpen(true)} accessibilityLabel="Privacidad y perfil">
            <Text style={styles.avatarText}>AL</Text>
          </Pressable>
        </View>

        {view === "closet" && (
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => String(item.id)}
            numColumns={2}
            columnWrapperStyle={styles.cardRow}
            contentContainerStyle={styles.screenContent}
            ListHeaderComponent={
              <View>
                <View style={styles.headingRow}>
                  <View>
                    <Text style={styles.eyebrow}>{cloudWardrobe.length ? "TU ARMARIO PRIVADO" : "COLECCIÓN DE MUESTRA"}</Text>
                    <Text style={styles.pageTitle}>Armario <Text style={styles.count}>{activeWardrobe.length}</Text></Text>
                  </View>
                  <Pressable style={styles.importButton} onPress={() => setImportOpen(true)}>
                    <Text style={styles.importButtonText}>＋ Importar</Text>
                  </Pressable>
                </View>
                {batchReady && photos.length > 0 && (
                  <Pressable style={styles.batchBanner} onPress={() => setImportOpen(true)}>
                    <View style={styles.greenDot} />
                    <View style={styles.batchBannerText}>
                      <Text style={styles.batchTitle}>Lote local preparado</Text>
                      <Text style={styles.batchMeta}>{photos.length} fotos · {formatBytes(photoBytes)} · sin subir</Text>
                    </View>
                    <Text style={styles.reviewText}>Revisar</Text>
                  </Pressable>
                )}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  {filters.map((option) => (
                    <Pressable key={option.id} style={[styles.filter, filter === option.id && styles.filterActive]} onPress={() => setFilter(option.id)}>
                      <Text style={[styles.filterText, filter === option.id && styles.filterTextActive]}>{option.label}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.garmentCard} onPress={() => setSelectedItem(item)}>
                <GarmentVisual item={item} session={cloudSession} />
                <View style={styles.cardCopy}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>{item.type} · {item.color} · {statusLabel(item.status)}</Text>
                </View>
                {builderItems.includes(item.id) && <View style={styles.selectedDot}><Text style={styles.selectedDotText}>✓</Text></View>}
              </Pressable>
            )}
          />
        )}

        {view === "builder" && (
          <ScrollView contentContainerStyle={styles.builderScreen}>
            <Text style={styles.eyebrow}>ESTILISTA PERSONAL</Text>
            <Text style={styles.builderTitle}>Crea un look con lo que ya tienes.</Text>
            <Text style={styles.builderIntro}>Elige hasta tres prendas. La recomendación real se conectará a tu armario privado.</Text>

            <View style={styles.builderPanel}>
              <View style={styles.stepHeading}><Text style={styles.stepNumber}>01</Text><Text style={styles.stepTitle}>Prendas base</Text></View>
              <View style={styles.selectedStrip}>
                {[0, 1, 2].map((slot) => {
                  const item = activeWardrobe.find((entry) => entry.id === builderItems[slot]);
                  return item ? (
                    <Pressable key={slot} style={styles.selectedPiece} onPress={() => toggleBuilderItem(item.id)}>
                      <GarmentVisual item={item} session={cloudSession} />
                      <View style={styles.removeBubble}><Text style={styles.removeText}>×</Text></View>
                    </Pressable>
                  ) : (
                    <Pressable key={slot} style={styles.emptyPiece} onPress={() => setView("closet")}>
                      <Text style={styles.emptyPlus}>＋</Text><Text style={styles.emptyLabel}>Añadir</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.stepHeading}><Text style={styles.stepNumber}>02</Text><Text style={styles.stepTitle}>¿Cuál es el plan?</Text></View>
              <View style={styles.occasionGrid}>
                {occasions.map((option) => (
                  <Pressable key={option} style={[styles.occasion, occasion === option && styles.occasionActive]} onPress={() => setOccasion(option)}>
                    <Text style={[styles.occasionText, occasion === option && styles.occasionTextActive]}>{option}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.generateButton} onPress={() => setView("looks")}>
                <Text style={styles.generateButtonText}>Ver looks de muestra　✦</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}

        {view === "looks" && (
          <FlatList
            data={outfits}
            keyExtractor={(item) => String(item.id)}
            numColumns={2}
            columnWrapperStyle={styles.cardRow}
            contentContainerStyle={styles.screenContent}
            ListHeaderComponent={
              <View style={styles.headingRow}>
                <View>
                  <Text style={styles.eyebrow}>INSPIRACIÓN DE MUESTRA</Text>
                  <Text style={styles.pageTitle}>Looks <Text style={styles.count}>8</Text></Text>
                </View>
                <Pressable style={styles.importButton} onPress={() => setView("builder")}><Text style={styles.importButtonText}>Crear　✦</Text></Pressable>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.lookCard} onPress={() => setSelectedOutfit(item)}>
                <Sprite source={outfitSprite} index={item.id} columns={4} rows={2} aspectRatio={0.75} />
                <View style={styles.lookCopy}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>{item.occasion}</Text>
                </View>
              </Pressable>
            )}
          />
        )}

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => setView("closet")}>
            <Text style={[styles.navIcon, view === "closet" && styles.navActive]}>▦</Text><Text style={[styles.navLabel, view === "closet" && styles.navActive]}>Armario</Text>
          </Pressable>
          <Pressable style={styles.navCreate} onPress={() => setView("builder")}>
            <Text style={styles.navCreateIcon}>✦</Text><Text style={styles.navCreateLabel}>Crear</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setView("looks")}>
            <Text style={[styles.navIcon, view === "looks" && styles.navActive]}>▤</Text><Text style={[styles.navLabel, view === "looks" && styles.navActive]}>Looks</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={importOpen} transparent animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Pressable style={styles.closeButton} onPress={() => setImportOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <View style={styles.scanOrb}><Text style={styles.scanOrbText}>✦</Text></View>
            <Text style={[styles.eyebrow, styles.centerText]}>CARRETE DEL TELÉFONO</Text>
            <Text style={styles.modalTitle}>Elige las fotos para tu armario.</Text>
            <Text style={styles.modalIntro}>La selección permanece local hasta que tú decidas subirla. La nube nunca toma fotos por su cuenta.</Text>
            <View style={styles.privacyPill}><View style={cloudSession ? styles.greenDot : styles.rustDot} /><Text style={styles.privacyPillText}>{cloudSession ? "NUBE PRIVADA CONECTADA" : "LOCAL · NUBE POR EMPAREJAR"}</Text></View>

            <Pressable style={styles.photoPicker} onPress={pickPhotos} disabled={picking}>
              {picking ? <ActivityIndicator color="#A34F31" /> : <Text style={styles.photoPickerTitle}>{photos.length ? "Cambiar selección" : "Abrir carrete"}</Text>}
              <Text style={styles.photoPickerHint}>Fotos reales · máximo 40</Text>
            </Pressable>

            {photos.length > 0 && (
              <>
                <View style={styles.photoGrid}>
                  {photos.slice(0, 6).map((photo, index) => (
                    <View style={styles.photoCell} key={`${photo.assetId ?? photo.uri}-${index}`}>
                      <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                      {index === 5 && photos.length > 6 && <View style={styles.photoMore}><Text style={styles.photoMoreText}>+{photos.length - 6}</Text></View>}
                    </View>
                  ))}
                </View>
                <View style={styles.photoSummary}>
                  <Text style={styles.photoSummaryTitle}>{photos.length} fotos preparadas</Text>
                  <Text style={styles.photoSummaryMeta}>{formatBytes(photoBytes)} en este teléfono</Text>
                </View>
                {!batchReady && <Pressable style={styles.fullButton} onPress={prepareBatch}><Text style={styles.fullButtonText}>Dejar lote preparado</Text></Pressable>}
                {batchReady && (
                  <Pressable style={[styles.fullButton, uploading && styles.disabledButton]} onPress={uploadBatch} disabled={uploading}>
                    <Text style={styles.fullButtonText}>{uploading ? `Subiendo a tu nube… ${uploadProgress}%` : cloudSession ? "Subir a mi nube privada" : "Emparejar nube para subir"}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => { setPhotos([]); setBatchReady(false); }}><Text style={styles.deleteText}>Eliminar selección local</Text></Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={profileOpen} transparent animationType="slide" onRequestClose={() => setProfileOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.profileSheet}>
            <Pressable style={styles.closeButton} onPress={() => setProfileOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>AL</Text></View>
            <Text style={[styles.eyebrow, styles.centerText]}>VESTA DE ALAN</Text>
            <Text style={styles.modalTitle}>Tu nube privada.</Text>
            <Text style={styles.modalIntro}>La app nativa hablará con un backend privado. Nada tendrá una URL pública.</Text>
            <View style={styles.architectureCard}>
              <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ORIGINALES</Text><Text style={styles.architectureValue}>Privados</Text></View>
              <View style={styles.architectureRow}><Text style={styles.architectureLabel}>PNG Y RENDERS</Text><Text style={styles.architectureValue}>Privados</Text></View>
              <View style={styles.architectureRow}><Text style={styles.architectureLabel}>DUPLICADOS APARTADOS</Text><Text style={styles.architectureValue}>{duplicateCount}</Text></View>
              <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ACCESO</Text><Text style={styles.architectureValue}>Solo Alan</Text></View>
              <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ESTADO</Text><Text style={cloudSession ? styles.architectureValue : styles.architecturePending}>{cloudSession ? "Conectada" : pairing ? "Emparejando…" : "Por conectar"}</Text></View>
            </View>
            <Text style={styles.profileFootnote}>{cloudSession ? `${cloudWardrobe.length ? `${cloudWardrobe.length} prendas reales sincronizadas. ` : ""}Las credenciales de este dispositivo están guardadas en el llavero seguro del sistema.` : "Abre la web privada de Vesta en este teléfono y toca “Emparejar app nativa”. El enlace dura diez minutos."}</Text>
            {cloudSession && <Pressable style={styles.secondaryButton} onPress={() => loadWardrobe()} disabled={wardrobeLoading}><Text style={styles.secondaryButtonText}>{wardrobeLoading ? "Sincronizando…" : "Sincronizar armario"}</Text></Pressable>}
            {!cloudSession && <Pressable style={styles.fullButton} onPress={pairFromClipboard} disabled={pairing}><Text style={styles.fullButtonText}>{pairing ? "Emparejando…" : "Pegar enlace de emparejamiento"}</Text></Pressable>}
            {cloudSession && <Pressable onPress={disconnectCloud}><Text style={styles.deleteText}>Desconectar este teléfono</Text></Pressable>}
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(selectedItem)} transparent animationType="slide" onRequestClose={() => setSelectedItem(null)}>
        <View style={styles.detailBackdrop}>
          <View style={styles.detailSheet}>
            <Pressable style={styles.closeButton} onPress={() => setSelectedItem(null)}><Text style={styles.closeText}>×</Text></Pressable>
            {selectedItem && <GarmentVisual item={selectedItem} session={cloudSession} />}
            {selectedItem && (
              <View style={styles.detailCopy}>
                <Text style={styles.eyebrow}>{selectedItem.type.toUpperCase()}</Text>
                <Text style={styles.detailTitle}>{selectedItem.name}</Text>
                <Text style={styles.detailIntro}>{selectedItem.description || (selectedItem.imagePath ? `Detectada con ${selectedItem.confidence ?? 0}% de confianza. La vista actual muestra la foto de evidencia hasta generar el recorte transparente.` : "Muestra visual del armario. Esta ficha será reemplazada por la prenda extraída de tus fotos.")}</Text>
                {selectedItem.qaSummary?.summary && <Text style={styles.qaSummary}>{selectedItem.qaSummary.summary}</Text>}
                {selectedItem.imagePath && (
                  <Pressable style={[styles.fullButton, styles.reconstructAction, reconstructingId === selectedItem.id && styles.disabledButton]} onPress={() => chooseReconstruction(selectedItem)} disabled={reconstructingId === selectedItem.id}>
                    <Text style={styles.fullButtonText}>{reconstructingId === selectedItem.id ? "Creando y verificando…" : selectedItem.status === "approved" ? "Regenerar PNG" : "Crear PNG transparente"}</Text>
                  </Pressable>
                )}
                <Pressable style={styles.fullButton} onPress={() => toggleBuilderItem(selectedItem.id)}>
                  <Text style={styles.fullButtonText}>{builderItems.includes(selectedItem.id) ? "✓ En el creador" : "＋ Usar en un look"}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(selectedOutfit)} transparent animationType="slide" onRequestClose={() => setSelectedOutfit(null)}>
        <View style={styles.detailBackdrop}>
          <View style={styles.detailSheet}>
            <Pressable style={styles.closeButton} onPress={() => setSelectedOutfit(null)}><Text style={styles.closeText}>×</Text></Pressable>
            {selectedOutfit && <Sprite source={outfitSprite} index={selectedOutfit.id} columns={4} rows={2} aspectRatio={0.75} />}
            {selectedOutfit && (
              <View style={styles.detailCopy}>
                <Text style={styles.eyebrow}>{selectedOutfit.occasion.toUpperCase()}</Text>
                <Text style={styles.detailTitle}>{selectedOutfit.name}</Text>
                <Text style={styles.detailIntro}>{selectedOutfit.note}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const ink = "#211F1B";
const paper = "#F3EFE5";
const rust = "#A34F31";
const muted = "#777165";
const line = "#D8D1C4";

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: paper },
  app: { flex: 1, backgroundColor: paper },
  topbar: { height: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: ink },
  brandLetter: { color: paper, fontSize: 15, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  brandName: { color: ink, fontSize: 12, fontWeight: "700", letterSpacing: 2.4 },
  cloudBadge: { marginLeft: "auto", marginRight: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  cloudBadgeText: { color: "#60705B", fontSize: 7, fontWeight: "700", letterSpacing: 0.8 },
  cloudBadgePending: { color: rust },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#71826A" },
  rustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: rust },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ink },
  avatarText: { color: ink, fontSize: 9, fontWeight: "700" },
  screenContent: { paddingHorizontal: 16, paddingTop: 26, paddingBottom: 110 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  eyebrow: { color: rust, fontSize: 8, fontWeight: "700", letterSpacing: 1.45, marginBottom: 7 },
  pageTitle: { color: ink, fontSize: 38, lineHeight: 40, letterSpacing: -1.5, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  count: { color: muted, fontSize: 16 },
  importButton: { backgroundColor: ink, paddingHorizontal: 13, paddingVertical: 11 },
  importButtonText: { color: paper, fontSize: 9, fontWeight: "700" },
  batchBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 15, padding: 11, borderWidth: 1, borderColor: "#B7C0B2", backgroundColor: "#EDF0E8" },
  batchBannerText: { flex: 1, gap: 2 },
  batchTitle: { color: ink, fontSize: 10, fontWeight: "700" },
  batchMeta: { color: muted, fontSize: 8 },
  reviewText: { color: ink, fontSize: 8, fontWeight: "700", textDecorationLine: "underline" },
  filters: { gap: 7, paddingBottom: 18 },
  filter: { borderWidth: 1, borderColor: line, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20 },
  filterActive: { backgroundColor: ink, borderColor: ink },
  filterText: { color: muted, fontSize: 9 },
  filterTextActive: { color: paper },
  cardRow: { gap: 9 },
  garmentCard: { flex: 1, position: "relative", marginBottom: 13, backgroundColor: "#EAE5DA", borderWidth: StyleSheet.hairlineWidth, borderColor: line },
  spriteFrame: { width: "100%", overflow: "hidden", backgroundColor: "#E8E2D6" },
  cloudGarmentImage: { width: "100%", height: "100%" },
  evidenceBadge: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: "rgba(33,31,27,.78)" },
  evidenceBadgeText: { color: paper, fontSize: 6, fontWeight: "800", letterSpacing: 0.7 },
  cardCopy: { padding: 10, backgroundColor: "#F8F5ED" },
  cardTitle: { color: ink, fontSize: 10, fontWeight: "700" },
  cardMeta: { color: muted, fontSize: 8, marginTop: 3 },
  selectedDot: { position: "absolute", right: 7, top: 7, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: ink },
  selectedDotText: { color: paper, fontSize: 9 },
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 78, paddingBottom: Platform.OS === "ios" ? 8 : 0, flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line, backgroundColor: "#F8F5ED" },
  navItem: { width: 82, alignItems: "center", gap: 3 },
  navIcon: { color: muted, fontSize: 18 },
  navLabel: { color: muted, fontSize: 8 },
  navActive: { color: ink, fontWeight: "700" },
  navCreate: { width: 57, height: 57, marginTop: -24, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: ink, borderWidth: 4, borderColor: paper },
  navCreateIcon: { color: paper, fontSize: 17 },
  navCreateLabel: { color: paper, fontSize: 7, marginTop: 2 },
  builderScreen: { padding: 22, paddingBottom: 115 },
  builderTitle: { color: ink, maxWidth: 330, fontSize: 42, lineHeight: 44, letterSpacing: -1.7, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  builderIntro: { color: muted, fontSize: 11, lineHeight: 17, marginTop: 14, marginBottom: 25 },
  builderPanel: { backgroundColor: "#F8F5ED", padding: 17, borderWidth: 1, borderColor: line },
  stepHeading: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 12, marginTop: 4 },
  stepNumber: { color: rust, fontSize: 8, fontWeight: "800" },
  stepTitle: { color: ink, fontSize: 13, fontWeight: "700" },
  selectedStrip: { flexDirection: "row", gap: 8, marginBottom: 26 },
  selectedPiece: { flex: 1, position: "relative", borderWidth: 1, borderColor: line },
  removeBubble: { position: "absolute", top: 4, right: 4, width: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(33,31,27,.8)" },
  removeText: { color: paper, lineHeight: 17 },
  emptyPiece: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: line },
  emptyPlus: { color: muted, fontSize: 18 },
  emptyLabel: { color: muted, fontSize: 8 },
  occasionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 20 },
  occasion: { width: "48%", paddingVertical: 12, alignItems: "center", borderWidth: 1, borderColor: line },
  occasionActive: { backgroundColor: ink, borderColor: ink },
  occasionText: { color: muted, fontSize: 9 },
  occasionTextActive: { color: paper, fontWeight: "700" },
  generateButton: { alignItems: "center", backgroundColor: rust, paddingVertical: 15 },
  generateButtonText: { color: "#FFF9EF", fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  lookCard: { flex: 1, marginBottom: 14, backgroundColor: "#EAE5DA" },
  lookCopy: { padding: 10, backgroundColor: "#F8F5ED" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.45)" },
  modalSheet: { maxHeight: "92%", paddingHorizontal: 20, paddingTop: 32, paddingBottom: 30, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  profileSheet: { paddingHorizontal: 22, paddingTop: 38, paddingBottom: 42, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  closeButton: { position: "absolute", zIndex: 5, right: 14, top: 12, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.65)" },
  closeText: { color: ink, fontSize: 25, fontWeight: "300" },
  scanOrb: { width: 58, height: 58, marginBottom: 20, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 29, borderWidth: 1, borderColor: line, backgroundColor: "#F8F5ED" },
  scanOrbText: { color: rust, fontSize: 20 },
  centerText: { textAlign: "center" },
  modalTitle: { color: ink, fontSize: 34, lineHeight: 37, textAlign: "center", letterSpacing: -1.2, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  modalIntro: { color: muted, maxWidth: 330, alignSelf: "center", textAlign: "center", fontSize: 10, lineHeight: 16, marginTop: 12, marginBottom: 13 },
  privacyPill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#BCC5B8", backgroundColor: "#EDF0E8" },
  privacyPillText: { color: "#60705B", fontSize: 7, fontWeight: "800", letterSpacing: 0.7 },
  photoPicker: { height: 91, marginTop: 16, marginBottom: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: "#B8B0A2", backgroundColor: "#F8F5ED" },
  photoPickerTitle: { color: ink, fontSize: 11, fontWeight: "700" },
  photoPickerHint: { color: muted, fontSize: 8, marginTop: 6 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  photoCell: { position: "relative", width: "31.8%", aspectRatio: 1, overflow: "hidden", backgroundColor: "#E8E2D6" },
  photoThumb: { width: "100%", height: "100%" },
  photoMore: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(24,22,19,.58)" },
  photoMoreText: { color: "white", fontSize: 16, fontWeight: "800" },
  photoSummary: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 13 },
  photoSummaryTitle: { color: ink, fontSize: 9, fontWeight: "700" },
  photoSummaryMeta: { color: muted, fontSize: 8 },
  fullButton: { width: "100%", alignItems: "center", backgroundColor: ink, paddingVertical: 15 },
  secondaryButton: { width: "100%", alignItems: "center", marginTop: 14, borderWidth: 1, borderColor: ink, paddingVertical: 13 },
  secondaryButtonText: { color: ink, fontSize: 9, fontWeight: "800" },
  reconstructAction: { marginBottom: 8, backgroundColor: rust },
  disabledButton: { opacity: 0.6 },
  fullButtonText: { color: paper, fontSize: 10, fontWeight: "800" },
  deleteText: { color: "#8B4733", textAlign: "center", fontSize: 9, paddingTop: 15 },
  profileAvatar: { width: 64, height: 64, marginBottom: 18, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 32, backgroundColor: ink },
  profileAvatarText: { color: paper, fontSize: 16, fontWeight: "800" },
  architectureCard: { marginTop: 10, borderTopWidth: 1, borderTopColor: line },
  architectureRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: line },
  architectureLabel: { color: muted, fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  architectureValue: { color: "#60705B", fontSize: 10, fontWeight: "700" },
  architecturePending: { color: rust, fontSize: 10, fontWeight: "700" },
  profileFootnote: { color: muted, textAlign: "center", fontSize: 9, lineHeight: 14, marginTop: 18 },
  detailBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.45)" },
  detailSheet: { maxHeight: "90%", overflow: "hidden", backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  detailCopy: { padding: 22, paddingBottom: 34 },
  detailTitle: { color: ink, fontSize: 34, lineHeight: 37, letterSpacing: -1.2, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  detailIntro: { color: muted, fontSize: 10, lineHeight: 16, marginTop: 12, marginBottom: 20 },
  qaSummary: { color: rust, fontSize: 9, lineHeight: 14, marginTop: -8, marginBottom: 18 },
});

function cloudFetch(session: CloudSession, path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("OAI-Sites-Authorization", `Bearer ${session.dispatchToken}`);
  headers.set("x-vesta-device-token", session.deviceToken);
  return fetch(`${session.apiUrl}${path}`, { ...init, headers });
}

function authorizedImageSource(session: CloudSession, path: string) {
  return {
    uri: `${session.apiUrl}${path}`,
    headers: {
      "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
      "x-vesta-device-token": session.deviceToken,
    },
  };
}

function categoryForUi(category: string): Exclude<Category, "all"> {
  if (category === "tops" || category === "layers" || category === "bottoms" || category === "accessories") return category;
  if (category === "footwear") return "accessories";
  if (category === "one_piece") return "layers";
  return "accessories";
}

function statusLabel(status?: string) {
  if (status === "approved") return "verificada";
  if (status === "qa") return "revisar PNG";
  if (status === "held") return "evidencia débil";
  if (status === "reconstructing") return "procesando";
  return "por reconstruir";
}

function mimeTypeFor(photo: ImagePicker.ImagePickerAsset) {
  const reported = photo.mimeType?.toLowerCase();
  if (reported === "image/jpg") return "image/jpeg";
  if (reported) return reported;
  const extension = extensionFor(photo);
  if (extension === "png") return "image/png";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
}

function extensionFor(photo: ImagePicker.ImagePickerAsset) {
  const value = photo.fileName || photo.uri;
  const match = value.match(/\.([a-z0-9]+)(?:\?|$)/iu);
  const extension = match?.[1]?.toLowerCase();
  return extension && ["jpg", "jpeg", "png", "heic", "heif", "webp"].includes(extension) ? extension : "jpg";
}
