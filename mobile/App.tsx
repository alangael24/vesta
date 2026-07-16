import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  beginDeviceAuthorization,
  CODEX_DEVICE_URL,
  completeDeviceAuthorization,
  getCodexSession,
  logoutCodex,
} from "./codex-auth";
import {
  analyzeExperimentalInventory,
  EXPERIMENTAL_CODEX_MODEL,
  ExperimentalPhoto,
  generateExperimentalAvatarImage,
  generateExperimentalGarmentImage,
  generateExperimentalTryOnImage,
  prepareAvatarTryOnReference,
  prepareTryOnGarmentReference,
} from "./experimental-inventory";
import { SubscriptionPaywall } from "./SubscriptionPaywall";
import { PrivacyPolicyModal } from "./PrivacyPolicy";

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
  sourceType?: "photos" | "internet";
  sourceUrl?: string | null;
  confidence?: number | null;
  isBasic?: boolean;
  status?: string;
  reconstructionQuality?: "draft" | "final" | null;
  transparentPixelRatio?: number | null;
  qaStatus?: "pending" | "pass" | "review" | "fail" | null;
  qaSummary?: { summary?: string | null; issues?: string[] };
  imagePath?: string | null;
  localImageUri?: string | null;
  evidencePath?: string | null;
  imageKind?: "cutout" | "evidence";
  spriteIndex?: number;
};

type Outfit = {
  id: string;
  name: string;
  occasion: string;
  note: string;
  renderPath?: string | null;
  localRenderUri?: string | null;
  avatarVersion?: string | null;
  status?: string;
  pieces: WardrobeItem[];
};

type TryOnLayer = {
  key: string;
  item: WardrobeItem;
};

type TryOnRenderQuality = "low" | "medium";
type ProductPlacementHint = "auto" | "head" | "top" | "outer" | "legs" | "feet";

type AvatarGenerationAudit = {
  recordedAt: string;
  flow: "builder" | "saved_look";
  status: "completed";
  quality: TryOnRenderQuality;
  garmentCount: number;
  garmentCacheHits: number;
  garmentCacheMisses: number;
  requestedSize: string;
  avatarInputBytes: number;
  garmentInputBytes: number;
  outputBytes: number;
  avatarPreparationMs: number;
  garmentPreparationMs: number;
  generationRoundTripMs: number;
  cloudUploadMs: number;
  localSaveMs: number;
  totalMs: number;
};

type BodyRegion = "head" | "torso" | "legs" | "feet";
type FittingSlot = "head" | "top" | "outer" | "legs" | "feet" | "accessory";
type WindowBounds = { x: number; y: number; width: number; height: number };
type WardrobeDrag = { item: WardrobeItem; x: number; y: number; overCanvas: boolean };

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
  sourceType?: "photos" | "internet";
  sourceUrl?: string | null;
  confidence?: number | null;
  isBasic?: boolean;
  status?: string;
  reconstructionQuality?: "draft" | "final" | null;
  transparentPixelRatio?: number | null;
  qaStatus?: "pending" | "pass" | "review" | "fail" | null;
  qaSummary?: { summary?: string | null; issues?: string[] };
  imagePath?: string | null;
  evidencePath?: string | null;
  imageKind?: "cutout" | "evidence";
};

type CloudAvatar = {
  mediaPath: string;
  version: string;
  updatedAt?: string | null;
};

type CloudOutfit = Omit<Outfit, "pieces"> & { pieces: CloudGarment[] };

type ImportStage = "idle" | "waiting" | "staging" | "uploading" | "analyzing" | "complete" | "error";
type AppNotice = { id: number; tone: "success" | "error" | "info"; title: string; message?: string };

type QueuedImportPhoto = {
  asset: ImagePicker.ImagePickerAsset;
  uploadId?: string;
  uploadPath?: string;
  uploaded: boolean;
};

type PendingImportQueue = {
  version: 1;
  id: string;
  batchId?: string;
  photos: QueuedImportPhoto[];
  updatedAt: string;
};

type PendingTryOnQueue = {
  version: 1;
  id: string;
  deviceId: string;
  garmentIds: string[];
  quality: TryOnRenderQuality;
  outfitId?: string;
  usageReservationId?: string;
  renderFileUri?: string;
  updatedAt: string;
};

const cloudKeys = {
  apiUrl: "vesta.api-url",
  dispatchToken: "vesta.dispatch-token",
  deviceToken: "vesta.device-token",
  deviceId: "vesta.device-id",
};
const CLOUD_CONNECT_URL = "https://vesta-armario-alan.alangael2411.chatgpt.site/api/v1/pairing";
const TRY_ON_RENDER_PREFIX = "vesta-try-on-render";
const IMPORT_QUEUE_MANIFEST = "vesta-import-queue.json";
const TRY_ON_QUEUE_MANIFEST = "vesta-try-on-queue.json";
const WARDROBE_INDEX_CACHE = "wardrobe.json";
const IMPORT_UPLOAD_CONCURRENCY = 3;
const WARDROBE_DOWNLOAD_CONCURRENCY = 4;
const LOOKS_DOWNLOAD_CONCURRENCY = 4;

function wardrobeIndexCachePath(session: CloudSession) {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${accountCachePrefix(session)}-${WARDROBE_INDEX_CACHE}` : null;
}

function wardrobeImageCachePath(session: CloudSession, garmentId: ItemId) {
  if (!FileSystem.documentDirectory) return null;
  const safeGarmentId = String(garmentId).replace(/[^a-z0-9_-]/giu, "_");
  return `${FileSystem.documentDirectory}vesta-${accountCachePrefix(session)}-garment-${safeGarmentId}.png`;
}

async function readWardrobeCache(session: CloudSession) {
  const path = wardrobeIndexCachePath(session);
  if (!path) return [];
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as WardrobeItem[];
    if (!Array.isArray(parsed)) return [];
    const available = await Promise.all(parsed.map(async (item) => {
      if (!item.localImageUri) return item;
      const image = await FileSystem.getInfoAsync(item.localImageUri).catch(() => null);
      return image?.exists ? item : { ...item, localImageUri: null };
    }));
    return available;
  } catch {
    return [];
  }
}

async function persistWardrobeCache(session: CloudSession, items: WardrobeItem[]) {
  const path = wardrobeIndexCachePath(session);
  if (path) await FileSystem.writeAsStringAsync(path, JSON.stringify(items));
}

function tryOnQueueManifestPath() {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${TRY_ON_QUEUE_MANIFEST}` : null;
}

async function persistTryOnQueue(queue: PendingTryOnQueue) {
  const path = tryOnQueueManifestPath();
  if (!path) throw new Error("try_on_queue_unavailable");
  await FileSystem.writeAsStringAsync(path, JSON.stringify(queue));
}

async function readTryOnQueue() {
  const path = tryOnQueueManifestPath();
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as PendingTryOnQueue;
    if (parsed.version !== 1 || !parsed.id || !parsed.deviceId || !Array.isArray(parsed.garmentIds) || !parsed.garmentIds.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function clearTryOnQueue() {
  const path = tryOnQueueManifestPath();
  if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
}

function importQueueManifestPath() {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${IMPORT_QUEUE_MANIFEST}` : null;
}

function importQueueDirectory(queueId: string) {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-import-${queueId}/` : null;
}

async function persistImportQueue(queue: PendingImportQueue) {
  const path = importQueueManifestPath();
  if (!path) return;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(queue));
}

async function readImportQueue() {
  const path = importQueueManifestPath();
  if (!path) return null;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path)) as PendingImportQueue;
    if (parsed.version !== 1 || !parsed.id || !Array.isArray(parsed.photos) || !parsed.photos.length) return null;
    const available: QueuedImportPhoto[] = [];
    for (const photo of parsed.photos) {
      const local = await FileSystem.getInfoAsync(photo.asset?.uri || "").catch(() => null);
      if (local?.exists) available.push(photo);
    }
    if (available.length !== parsed.photos.length) {
      await clearImportQueue(parsed);
      return null;
    }
    return { ...parsed, photos: available };
  } catch {
    return null;
  }
}

async function clearImportQueue(queue?: PendingImportQueue | null) {
  const path = importQueueManifestPath();
  if (path) await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
  if (queue) {
    const directory = importQueueDirectory(queue.id);
    if (directory) await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
  }
}

async function stageImportQueue(assets: ImagePicker.ImagePickerAsset[]) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const directory = importQueueDirectory(id);
  if (!directory) throw new Error("import_storage_unavailable");
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const queued: QueuedImportPhoto[] = [];
  try {
    for (let index = 0; index < assets.length; index += 1) {
      const source = assets[index];
      const extension = extensionFor(source);
      const uri = `${directory}photo-${index + 1}.${extension}`;
      await FileSystem.copyAsync({ from: source.uri, to: uri });
      const info = await FileSystem.getInfoAsync(uri);
      const fileSize = source.fileSize || (info.exists && "size" in info ? info.size : undefined);
      if (!fileSize) throw new Error("import_photo_size_unavailable");
      queued.push({
        asset: {
          uri,
          width: source.width,
          height: source.height,
          type: "image",
          fileName: source.fileName || `foto-${index + 1}.${extension}`,
          fileSize,
          mimeType: mimeTypeFor(source),
          assetId: source.assetId,
        },
        uploaded: false,
      });
    }
    const queue: PendingImportQueue = { version: 1, id, photos: queued, updatedAt: new Date().toISOString() };
    await persistImportQueue(queue);
    return queue;
  } catch (error) {
    await FileSystem.deleteAsync(directory, { idempotent: true }).catch(() => undefined);
    throw error;
  }
}

async function runImportPool<T>(values: T[], worker: (value: T, index: number) => Promise<void>) {
  return runPool(values, IMPORT_UPLOAD_CONCURRENCY, worker);
}

async function runPool<T>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<void>) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(values[index], index);
    }
  });
  await Promise.all(workers);
}

function outfitsForUi(values: CloudOutfit[]) {
  return values.map((outfit) => ({
    ...outfit,
    pieces: outfit.pieces.map((piece) => ({ ...piece, category: categoryForUi(piece.category) })),
  }));
}

function mergeCachedOutfits(values: CloudOutfit[], cachedValues: Outfit[]) {
  const cachedById = new Map(cachedValues.map((outfit) => [outfit.id, outfit]));
  return outfitsForUi(values).map((outfit) => {
    const cached = cachedById.get(outfit.id);
    return {
      ...outfit,
      localRenderUri: cached && comparableMediaPath(cached.renderPath) === comparableMediaPath(outfit.renderPath)
        ? cached.localRenderUri
        : null,
    };
  });
}

function comparableMediaPath(value?: string | null) {
  return value?.split("?", 1)[0] || null;
}

function tryOnSignatureFor(layers: TryOnLayer[]) {
  return layers.map((layer) => `${layer.item.id}:${layer.item.imagePath || ""}`).join("|");
}

const wardrobeSprite = require("./assets/wardrobe-sprite.png") as ImageSourcePropType;
const legacyAlanAvatar = require("./assets/alan-avatar-base.png") as ImageSourcePropType;

const filters: { id: Category; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "tops", label: "Arriba" },
  { id: "layers", label: "Capas" },
  { id: "bottoms", label: "Abajo" },
  { id: "accessories", label: "Accesorios" },
];

const productPlacements: Array<{ id: ProductPlacementHint; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "head", label: "Cabeza" },
  { id: "top", label: "Arriba" },
  { id: "outer", label: "Capa" },
  { id: "legs", label: "Piernas" },
  { id: "feet", label: "Pies" },
];

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
  if (item.localImageUri) {
    return (
      <View style={[styles.spriteFrame, { aspectRatio: 1 }]}>
        <Image source={{ uri: item.localImageUri }} resizeMode={item.imageKind === "cutout" ? "contain" : "cover"} style={styles.cloudGarmentImage} />
        {item.imageKind === "evidence" && <View style={styles.evidenceBadge}><Text style={styles.evidenceBadgeText}>EVIDENCIA</Text></View>}
        {item.sourceType === "internet" && <View style={styles.internetBadge}><Text style={styles.internetBadgeText}>WEB</Text></View>}
      </View>
    );
  }
  if (item.imagePath && session) {
    return (
      <View style={[styles.spriteFrame, { aspectRatio: 1 }]}>
        <Image source={authorizedImageSource(session, item.imagePath)} resizeMode={item.imageKind === "cutout" ? "contain" : "cover"} style={styles.cloudGarmentImage} />
        {item.imageKind === "evidence" && <View style={styles.evidenceBadge}><Text style={styles.evidenceBadgeText}>EVIDENCIA</Text></View>}
        {item.sourceType === "internet" && <View style={styles.internetBadge}><Text style={styles.internetBadgeText}>WEB</Text></View>}
      </View>
    );
  }
  return <Sprite source={wardrobeSprite} index={item.spriteIndex ?? Number(item.id)} columns={4} rows={4} />;
}

function OutfitVisual({
  outfit,
  session,
  showPieces = false,
}: {
  outfit: Outfit;
  session: CloudSession | null;
  showPieces?: boolean;
}) {
  const visiblePieces = outfit.pieces.slice(0, 6);
  const collageColumns = visiblePieces.length > 4 ? 3 : 2;
  const cellWidth = 100 / collageColumns;
  const renderSource = outfit.localRenderUri
    ? { uri: outfit.localRenderUri }
    : outfit.renderPath && session ? authorizedImageSource(session, outfit.renderPath) : null;
  const revealProgress = useRef(new Animated.Value(showPieces ? 1 : 0)).current;

  useEffect(() => {
    const animation = Animated.spring(revealProgress, {
      toValue: showPieces ? 1 : 0,
      damping: 22,
      stiffness: 250,
      mass: 0.72,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [revealProgress, showPieces]);

  return (
    <View style={styles.outfitCollage}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.outfitVisualLayer,
          renderSource ? {
            opacity: revealProgress.interpolate({ inputRange: [0, 0.22, 1], outputRange: [0, 0.48, 1] }),
            transform: [
              { translateX: revealProgress.interpolate({ inputRange: [0, 1], outputRange: [-34, 0] }) },
              { scale: revealProgress.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
          } : { opacity: 1 },
        ]}
      >
        {visiblePieces.map((piece, index) => (
          <Animated.View
            key={String(piece.id)}
            style={[
              styles.outfitCollageCell,
              {
                width: `${cellWidth}%`,
                left: `${(index % collageColumns) * cellWidth}%`,
                top: index < collageColumns ? "0%" : "50%",
              },
              renderSource ? {
                transform: [
                  {
                    translateX: revealProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [(collageColumns - 1 - (index % collageColumns) * 2) * 9, 0],
                    }),
                  },
                  {
                    translateY: revealProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [index < collageColumns ? 10 : -10, 0],
                    }),
                  },
                ],
              } : null,
            ]}
          >
            {piece.imagePath && session
              ? <Image source={authorizedImageSource(session, piece.imagePath)} resizeMode="contain" style={styles.outfitCollageImage} />
              : <Text style={styles.outfitCollageFallback}>✦</Text>}
          </Animated.View>
        ))}
        <View style={styles.outfitPendingBadge}>
          <Text style={styles.outfitPendingBadgeText}>{renderSource ? "PRENDAS DEL LOOK" : "FOTO PENDIENTE"}</Text>
        </View>
      </Animated.View>
      {renderSource && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.outfitVisualLayer,
            {
              opacity: revealProgress.interpolate({ inputRange: [0, 0.76, 1], outputRange: [1, 0.22, 0] }),
              transform: [
                { translateX: revealProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 46] }) },
                { scale: revealProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] }) },
              ],
            },
          ]}
        >
          <Image source={renderSource} resizeMode="cover" style={styles.outfitRenderImage} />
          <View style={styles.outfitReadyBadge}><Text style={styles.outfitReadyBadgeText}>LOOK REAL</Text></View>
        </Animated.View>
      )}
    </View>
  );
}

function LookCard({
  outfit,
  session,
  onOpen,
  onPeek,
  onPeekEnd,
  showPieces,
}: {
  outfit: Outfit;
  session: CloudSession | null;
  onOpen: () => void;
  onPeek: () => void;
  onPeekEnd: () => void;
  showPieces: boolean;
}) {
  const longPressActive = useRef(false);
  return (
    <Pressable
      style={styles.lookCard}
      delayLongPress={100}
      onPressIn={() => { longPressActive.current = false; }}
      onLongPress={() => {
        longPressActive.current = true;
        onPeek();
      }}
      onPressOut={() => {
        if (longPressActive.current) onPeekEnd();
      }}
      onPress={() => {
        if (longPressActive.current) return;
        onOpen();
      }}
      accessibilityLabel={outfit.name}
      accessibilityHint="Toca para abrir o mantén presionado para ver las prendas del outfit"
    >
      <OutfitVisual outfit={outfit} session={session} showPieces={showPieces} />
      <View style={styles.lookCopy}>
        <Text style={styles.cardTitle}>{outfit.name}</Text>
        <Text style={styles.cardMeta}>{outfit.occasion} · {outfit.pieces.length} prendas · {outfit.renderPath ? "foto lista" : "foto pendiente"}</Text>
        <Text style={styles.lookHoldHint}>MANTÉN PRESIONADO PARA VER LAS PRENDAS</Text>
      </View>
    </Pressable>
  );
}

function fittingSlotFor(item: WardrobeItem): FittingSlot {
  const descriptor = `${item.type} ${item.name} ${item.description || ""}`.toLowerCase();
  if (/(gorra|cachucha|sombrero|beanie|bucket|\bcap\b|\bhat\b)/u.test(descriptor)) return "head";
  if (/(zapato|tenis|shoe|sneaker|bota|calzado)/u.test(descriptor)) return "feet";
  if (item.category === "bottoms") return "legs";
  if (item.category === "layers") return "outer";
  if (item.category === "tops") return "top";
  return "accessory";
}

function bodyRegionFor(item: WardrobeItem): BodyRegion {
  const slot = fittingSlotFor(item);
  if (slot === "head") return "head";
  if (slot === "feet") return "feet";
  if (slot === "legs") return "legs";
  return "torso";
}

function imagePlacementFor(item: WardrobeItem) {
  const slot = fittingSlotFor(item);
  if (slot === "head") return "head" as const;
  if (slot === "top") return "upper_body" as const;
  if (slot === "outer") return "outer_layer" as const;
  if (slot === "legs") return "lower_body" as const;
  if (slot === "feet") return "feet" as const;
  return "accessory" as const;
}

function bodyRegionLabel(region: BodyRegion) {
  if (region === "head") return "SUELTA EN LA CABEZA";
  if (region === "legs") return "SUELTA EN LAS PIERNAS";
  if (region === "feet") return "SUELTA EN LOS PIES";
  return "SUELTA EN EL TORSO";
}

function DraggableTryOnRailItem({
  item,
  session,
  active,
  onPress,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  item: WardrobeItem;
  session: CloudSession | null;
  active: boolean;
  onPress: () => void;
  onDragStart: (item: WardrobeItem, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (item: WardrobeItem, x: number, y: number) => void;
}) {
  const suppressTapUntil = useRef(0);
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 0.8,
    onPanResponderGrant: (_, gesture) => {
      suppressTapUntil.current = Date.now() + 700;
      onDragStart(item, gesture.x0, gesture.y0);
    },
    onPanResponderMove: (_, gesture) => onDragMove(gesture.moveX, gesture.moveY),
    onPanResponderRelease: (_, gesture) => onDragEnd(item, gesture.moveX, gesture.moveY),
    onPanResponderTerminate: (_, gesture) => onDragEnd(item, gesture.moveX, gesture.moveY),
  })).current;

  return (
    <Pressable
      {...panResponder.panHandlers}
      style={[styles.tryOnRailItem, active && styles.tryOnRailItemActive]}
      onPress={() => {
        if (Date.now() >= suppressTapUntil.current) onPress();
      }}
      accessibilityLabel={`Probar ${item.name}`}
      accessibilityHint="Toca para colocar o arrastra hacia la zona iluminada del cuerpo"
    >
      <GarmentVisual item={item} session={session} />
      <Text style={styles.tryOnRailLabel} numberOfLines={1}>{item.name}</Text>
      <View style={styles.dragAffordance}><Text style={styles.dragAffordanceText}>↕</Text></View>
    </Pressable>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function productImportErrorMessage(code: string) {
  if (/invalid_url|unsafe_url/u.test(code)) return "El enlace no es una página pública válida. Revisa que empiece con https://.";
  if (/product_page_blocked/u.test(code)) return "Esa tienda bloqueó la lectura automática. Prueba con el enlace directo de la imagen del producto.";
  if (/product_image_missing/u.test(code)) return "La página no indicó cuál es la foto principal. Prueba con el enlace directo de la imagen.";
  if (/too_large/u.test(code)) return "La página o imagen es demasiado grande para importarla de forma segura.";
  if (/product_unreachable|redirect/u.test(code)) return "La tienda no respondió correctamente. Comprueba el enlace o inténtalo otra vez.";
  return "No logramos extraer una imagen de producto utilizable. La tienda y tu armario no fueron modificados.";
}

export default function App() {
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [view, setView] = useState<ViewName>("closet");
  const [filter, setFilter] = useState<Category>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [productPlacement, setProductPlacement] = useState<ProductPlacementHint>("auto");
  const [productImporting, setProductImporting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reviewLoginOpen, setReviewLoginOpen] = useState(false);
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewSigningIn, setReviewSigningIn] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarSelfie, setAvatarSelfie] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarFullBody, setAvatarFullBody] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarConsent, setAvatarConsent] = useState(false);
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarDraftUri, setAvatarDraftUri] = useState<string | null>(null);
  const [cloudAvatar, setCloudAvatar] = useState<CloudAvatar | null>(null);
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const [peekedOutfit, setPeekedOutfit] = useState<Outfit | null>(null);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImportQueue | null>(null);
  const [importStage, setImportStage] = useState<ImportStage>("idle");
  const [importMessage, setImportMessage] = useState("");
  const [picking, setPicking] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [codexConnected, setCodexConnected] = useState(false);
  const [codexConnecting, setCodexConnecting] = useState(false);
  const [experimentalProgress, setExperimentalProgress] = useState(0);
  const [reconstructingId, setReconstructingId] = useState<ItemId | null>(null);
  const [cloudWardrobe, setCloudWardrobe] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitsLoading, setOutfitsLoading] = useState(false);
  const [outfitGenerating, setOutfitGenerating] = useState(false);
  const [outfitGenerationProgress, setOutfitGenerationProgress] = useState<{ current: number; total: number } | null>(null);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [wardrobeLoading, setWardrobeLoading] = useState(false);
  const [tryOnLayers, setTryOnLayers] = useState<TryOnLayer[]>([]);
  const [tryOnRendering, setTryOnRendering] = useState(false);
  const [tryOnRenderingQuality, setTryOnRenderingQuality] = useState<TryOnRenderQuality>("low");
  const [tryOnResultQuality, setTryOnResultQuality] = useState<TryOnRenderQuality | null>(null);
  const [tryOnRenderedUri, setTryOnRenderedUri] = useState<string | null>(null);
  const [tryOnRenderedSignature, setTryOnRenderedSignature] = useState<string | null>(null);
  const [tryOnSavedOutfitId, setTryOnSavedOutfitId] = useState<string | null>(null);
  const [pendingTryOn, setPendingTryOn] = useState<PendingTryOnQueue | null>(null);
  const [tryOnResumeEpoch, setTryOnResumeEpoch] = useState(0);
  const [wardrobeDrag, setWardrobeDrag] = useState<WardrobeDrag | null>(null);
  const appRootRef = useRef<View | null>(null);
  const appRootWindow = useRef({ x: 0, y: 0 });
  const tryOnCanvasRef = useRef<View | null>(null);
  const tryOnCanvasWindow = useRef<WindowBounds | null>(null);
  const tryOnAvatarBase64 = useRef<string | null>(null);
  const avatarDraftBase64 = useRef<string | null>(null);
  const tryOnGarmentBase64 = useRef(new Map<string, string>());
  const automaticCloudConnectionStarted = useRef(false);
  const importResumeStarted = useRef(false);
  const tryOnResumeStarted = useRef(false);
  const pendingAnalysisOffered = useRef(false);
  const avatarOnboardingOffered = useRef(false);
  const legacyAvatarMigrationStarted = useRef(false);

  function showNotice(title: string, message?: string, tone: AppNotice["tone"] = "info") {
    setNotice({ id: Date.now(), tone, title, message });
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice((current) => current?.id === notice.id ? null : current), notice.tone === "error" ? 5200 : 3200);
    return () => clearTimeout(timeout);
  }, [notice]);

  const activeWardrobe = cloudWardrobe;

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
    try {
      const response = await fetch(`${apiUrl}/api/v1/pairing/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OAI-Sites-Authorization": `Bearer ${dispatchToken}`,
        },
        body: JSON.stringify({
          code,
          name: Device.deviceName || (Platform.OS === "ios" ? "iPhone personal" : "Android personal"),
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
    } catch {
      automaticCloudConnectionStarted.current = false;
      showNotice("Reconectando tu cuenta", "Volveremos a intentarlo automáticamente.", "error");
    } finally {
      setPairing(false);
    }
  }

  async function signInForAppReview() {
    if (!reviewEmail.trim() || !reviewPassword) return;
    setReviewSigningIn(true);
    try {
      const response = await fetch(`${CLOUD_CONNECT_URL.replace(/\/api\/v1\/pairing$/u, "")}/api/v1/review-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: reviewEmail,
          password: reviewPassword,
          name: Device.deviceName || "Apple App Review",
        }),
      });
      if (!response.ok) throw new Error("review_login_failed");
      const session = await response.json() as CloudSession;
      await Promise.all([
        SecureStore.setItemAsync(cloudKeys.apiUrl, session.apiUrl),
        SecureStore.setItemAsync(cloudKeys.dispatchToken, session.dispatchToken),
        SecureStore.setItemAsync(cloudKeys.deviceToken, session.deviceToken),
        SecureStore.setItemAsync(cloudKeys.deviceId, session.deviceId),
      ]);
      setCloudSession(session);
      setReviewPassword("");
      setReviewLoginOpen(false);
      setProfileOpen(false);
      showNotice("Cuenta de revisión lista", "Ya puedes probar todas las funciones Premium.");
    } catch {
      showNotice("No pudimos iniciar sesión", "Revisa el correo y la contraseña de Apple Review.", "error");
    } finally {
      setReviewSigningIn(false);
    }
  }

  function startCloudConnection() {
    if (pairing) return;
    automaticCloudConnectionStarted.current = true;
    setPairing(true);
    Linking.openURL(CLOUD_CONNECT_URL).catch(() => {
      automaticCloudConnectionStarted.current = false;
      setPairing(false);
      showNotice("No pudimos abrir el acceso", "Inténtalo nuevamente desde tu perfil.", "error");
    });
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
      } else if (active && !automaticCloudConnectionStarted.current) {
        setProfileOpen(true);
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
    getCodexSession().then((session) => setCodexConnected(Boolean(session))).catch(() => undefined);
  }, []);

  useEffect(() => {
    readImportQueue().then((queue) => {
      if (!queue) return;
      setPendingImport(queue);
      setPhotos(queue.photos.map((photo) => photo.asset));
      setImportMessage("Continuaremos la importación desde la última foto pendiente.");
      setImportStage("waiting");
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    readTryOnQueue().then((queue) => {
      if (queue) setPendingTryOn(queue);
    }).catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      tryOnResumeStarted.current = false;
      setTryOnResumeEpoch((current) => current + 1);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!cloudSession || !pendingImport || importStage !== "waiting" || importResumeStarted.current) return;
    importResumeStarted.current = true;
    uploadBatch(pendingImport).catch(() => undefined);
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken, importStage, pendingImport?.id]);

  useEffect(() => {
    if (!cloudSession || !codexConnected || pendingAnalysisOffered.current) return;
    pendingAnalysisOffered.current = true;
    offerPendingExperimentalAnalysis(cloudSession).catch(() => undefined);
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken, codexConnected]);

  useEffect(() => {
    if (!cloudSession) {
      setCloudWardrobe([]);
      setOutfits([]);
      setCloudAvatar(null);
      setLocalAvatarUri(null);
      tryOnAvatarBase64.current = null;
      avatarOnboardingOffered.current = false;
      legacyAvatarMigrationStarted.current = false;
      return;
    }
    Promise.all([loadWardrobe(cloudSession), loadOutfits(cloudSession), loadAvatar(cloudSession)]).catch(() => undefined);
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken]);

  async function loadWardrobe(session = cloudSession) {
    if (!session) return;
    setWardrobeLoading(true);
    try {
      const cachedItems = await readWardrobeCache(session);
      if (cachedItems.length) setCloudWardrobe(cachedItems);
      const response = await cloudFetch(session, "/api/v1/wardrobe", { method: "GET" });
      if (!response.ok) return cachedItems;
      const result = await response.json() as { garments: CloudGarment[]; duplicateCount?: number };
      const cachedById = new Map(cachedItems.map((item) => [String(item.id), item]));
      const items = result.garments.map((item) => {
        const cached = cachedById.get(String(item.id));
        return {
          ...item,
          category: categoryForUi(item.category),
          localImageUri: cached && cached.imagePath === item.imagePath ? cached.localImageUri : null,
        };
      });
      setCloudWardrobe(items);
      setDuplicateCount(result.duplicateCount ?? 0);
      await persistWardrobeCache(session, items);
      cacheWardrobeImages(session, items).catch(() => undefined);
      return items;
    } finally {
      setWardrobeLoading(false);
    }
  }

  async function cacheWardrobeImages(session: CloudSession, values: WardrobeItem[]) {
    const nextItems = [...values];
    await runPool(values, WARDROBE_DOWNLOAD_CONCURRENCY, async (item, index) => {
      if (!item.imagePath || item.localImageUri) return;
      const localPath = wardrobeImageCachePath(session, item.id);
      if (!localPath) return;
      await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
      const download = await FileSystem.downloadAsync(`${session.apiUrl}${item.imagePath}`, localPath, {
        headers: {
          "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
          "x-vesta-device-token": session.deviceToken,
        },
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      }).catch(() => null);
      if (!download || download.status < 200 || download.status >= 300) return;
      nextItems[index] = { ...item, localImageUri: localPath };
      setCloudWardrobe((current) => current.map((entry) => String(entry.id) === String(item.id)
        ? { ...entry, localImageUri: localPath }
        : entry));
    });
    await persistWardrobeCache(session, nextItems);
  }

  async function loadOutfits(session = cloudSession) {
    if (!session) return;
    setOutfitsLoading(true);
    try {
      const indexPath = outfitIndexCachePath(session);
      let cachedOutfits: Outfit[] = [];
      if (indexPath) {
        const info = await FileSystem.getInfoAsync(indexPath).catch(() => null);
        if (info?.exists) {
          try {
            const parsedCache = JSON.parse(await FileSystem.readAsStringAsync(indexPath)) as unknown;
            if (Array.isArray(parsedCache)) {
              cachedOutfits = await Promise.all((parsedCache as Outfit[]).map(async (outfit) => {
                if (!outfit.renderPath) return outfit;
                const deterministicPath = outfitCachePath(session, outfit.id);
                const candidate = outfit.localRenderUri || deterministicPath;
                if (!candidate) return { ...outfit, localRenderUri: null };
                const image = await FileSystem.getInfoAsync(candidate).catch(() => null);
                return { ...outfit, localRenderUri: image?.exists ? candidate : null };
              }));
              setOutfits(cachedOutfits);
            }
          } catch {
            cachedOutfits = [];
            // A damaged local index never replaces the private cloud source of truth.
          }
        }
      }
      const response = await cloudFetch(session, "/api/v1/outfits", { method: "GET" });
      if (!response.ok) return;
      const result = await response.json() as { outfits?: CloudOutfit[] };
      const mappedOutfits = mergeCachedOutfits(result.outfits || [], cachedOutfits);
      setOutfits((current) => mergeCachedOutfits(result.outfits || [], [...cachedOutfits, ...current]));
      if (indexPath) {
        await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(mappedOutfits));
      }
      cacheOutfitRenders(session, mappedOutfits).catch(() => undefined);
    } finally {
      setOutfitsLoading(false);
    }
  }

  async function loadAvatar(session = cloudSession) {
    if (!session) return;
    const cachedPath = avatarCachePath(session);
    if (cachedPath) {
      const cached = await FileSystem.getInfoAsync(cachedPath).catch(() => null);
      if (cached?.exists) setLocalAvatarUri(cachedPath);
    }
    const response = await cloudFetch(session, "/api/v1/avatar", { method: "GET" });
    if (!response.ok) return;
    const result = await response.json() as { avatar?: CloudAvatar | null; legacyAvatarEligible?: boolean };
    if (!result.avatar) {
      if (result.legacyAvatarEligible) {
        await restoreLegacyAvatar(session, cachedPath);
        return;
      }
      setCloudAvatar(null);
      setLocalAvatarUri(null);
      tryOnAvatarBase64.current = null;
      if (cachedPath) await FileSystem.deleteAsync(cachedPath, { idempotent: true }).catch(() => undefined);
      if (!avatarOnboardingOffered.current) {
        avatarOnboardingOffered.current = true;
        setAvatarOpen(true);
      }
      return;
    }
    setCloudAvatar(result.avatar);
    if (!cachedPath) return;
    const nextPath = `${cachedPath}.next`;
    await FileSystem.deleteAsync(nextPath, { idempotent: true }).catch(() => undefined);
    const download = await FileSystem.downloadAsync(`${session.apiUrl}${result.avatar.mediaPath}`, nextPath, {
      headers: {
        "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
        "x-vesta-device-token": session.deviceToken,
      },
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    });
    if (download.status < 200 || download.status >= 300) return;
    await FileSystem.deleteAsync(cachedPath, { idempotent: true }).catch(() => undefined);
    await FileSystem.moveAsync({ from: nextPath, to: cachedPath });
    setLocalAvatarUri(cachedPath);
    tryOnAvatarBase64.current = null;
  }

  async function restoreLegacyAvatar(session: CloudSession, cachedPath: string | null) {
    if (legacyAvatarMigrationStarted.current) return;
    legacyAvatarMigrationStarted.current = true;
    const bundledAvatar = Image.resolveAssetSource(legacyAlanAvatar);
    setAvatarOpen(false);
    setLocalAvatarUri(bundledAvatar.uri);
    try {
      const base64 = await FileSystem.readAsStringAsync(bundledAvatar.uri, { encoding: FileSystem.EncodingType.Base64 });
      tryOnAvatarBase64.current = await prepareAvatarTryOnReference(bundledAvatar.uri);
      const avatar = await uploadAccountAvatar(session, base64);
      if (cachedPath) {
        await FileSystem.writeAsStringAsync(cachedPath, base64, { encoding: FileSystem.EncodingType.Base64 });
        setLocalAvatarUri(cachedPath);
      }
      setCloudAvatar(avatar);
    } catch {
      // Keep the bundled avatar visible and retry the private upload on the next sync.
      legacyAvatarMigrationStarted.current = false;
    }
  }

  async function cacheOutfitRenders(session: CloudSession, values: Outfit[]) {
    const renderedOutfits = values.filter((entry) => entry.renderPath);
    const nextOutfits = [...values];
    await runPool(renderedOutfits, LOOKS_DOWNLOAD_CONCURRENCY, async (outfit) => {
      const localPath = outfitCachePath(session, outfit.id);
      if (!localPath || !outfit.renderPath) return;
      let localRenderUri = outfit.localRenderUri;
      const info = localRenderUri ? await FileSystem.getInfoAsync(localRenderUri).catch(() => null) : null;
      if (!info?.exists) {
        await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
        const download = await FileSystem.downloadAsync(`${session.apiUrl}${outfit.renderPath}`, localPath, {
          headers: {
            "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
            "x-vesta-device-token": session.deviceToken,
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        }).catch(() => null);
        if (!download || download.status < 200 || download.status >= 300) return;
        localRenderUri = localPath;
      }
      const valueIndex = nextOutfits.findIndex((entry) => entry.id === outfit.id);
      if (valueIndex >= 0) nextOutfits[valueIndex] = { ...nextOutfits[valueIndex], localRenderUri };
      setOutfits((current) => current.map((entry) => entry.id === outfit.id && entry.renderPath === outfit.renderPath
        ? { ...entry, localRenderUri }
        : entry));
      setSelectedOutfit((current) => current?.id === outfit.id && current.renderPath === outfit.renderPath
        ? { ...current, localRenderUri }
        : current);
    });
    const indexPath = outfitIndexCachePath(session);
    if (indexPath) await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(nextOutfits));
  }

  async function accountAvatarBase64() {
    if (tryOnAvatarBase64.current) return tryOnAvatarBase64.current;
    if (!cloudSession) throw new Error("avatar_cloud_unavailable");
    const localPath = localAvatarUri || avatarCachePath(cloudSession);
    if (localPath) {
      const info = await FileSystem.getInfoAsync(localPath).catch(() => null);
      if (info?.exists) {
        tryOnAvatarBase64.current = await prepareAvatarTryOnReference(localPath);
        return tryOnAvatarBase64.current;
      }
    }
    if (!cloudAvatar?.mediaPath || !localPath) throw new Error("avatar_required");
    const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${cloudAvatar.mediaPath}`, localPath, {
      headers: {
        "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
        "x-vesta-device-token": cloudSession.deviceToken,
      },
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    });
    if (download.status < 200 || download.status >= 300) throw new Error(`avatar_download_${download.status}`);
    setLocalAvatarUri(localPath);
    tryOnAvatarBase64.current = await prepareAvatarTryOnReference(localPath);
    return tryOnAvatarBase64.current;
  }

  async function generateSavedOutfits() {
    if (!cloudSession || outfitGenerating) return;
    if (!localAvatarUri && !cloudAvatar) {
      Alert.alert("Crea tu avatar primero", "Outfit Club necesita tu avatar privado antes de poder mostrar cómo te quedan los Looks.", [
        { text: "Después", style: "cancel" },
        { text: "Crear avatar", onPress: () => setAvatarOpen(true) },
      ]);
      return;
    }
    if (!codexConnected) {
      Alert.alert(
        "Conecta tu cuenta para crear las fotos",
        "Tus combinaciones ya están guardadas. La conexión sólo se usa al crear una foto nueva.",
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Conectar", onPress: connectCodexExperiment },
        ],
      );
      return;
    }
    setOutfitGenerating(true);
    try {
      const pendingOutfits = outfits.filter((outfit) => !outfit.renderPath).slice(0, 3);
      if (pendingOutfits.length) {
        await completeOutfitPhotographs(pendingOutfits);
        return;
      }
      const response = await cloudFetch(cloudSession, "/api/v1/outfits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 3 }),
      });
      const result = await response.json() as { outfits?: CloudOutfit[]; created?: number; createdOutfitIds?: string[]; error?: string };
      const mappedOutfits = outfitsForUi(result.outfits || []);
      if (result.outfits) {
        setOutfits((current) => mergeCachedOutfits(result.outfits || [], current));
      }
      if (!response.ok) {
        if (result.error === "outfit_wardrobe_too_small") {
          showNotice("Faltan prendas", "Añade una prenda de arriba y un pantalón para crear nuevos Looks.");
        } else if (result.error === "outfit_combinations_exhausted") {
          showNotice("Ya encontraste todas", "Añade otra prenda para descubrir combinaciones nuevas.");
        } else {
          throw new Error(result.error || "outfit_generation_failed");
        }
        return;
      }
      const createdIds = new Set(result.createdOutfitIds || []);
      const createdOutfits = createdIds.size
        ? mappedOutfits.filter((outfit) => createdIds.has(outfit.id))
        : mappedOutfits.filter((outfit) => !outfit.renderPath).slice(0, result.created || 3);
      if (!createdOutfits.length) throw new Error("created_outfits_missing");
      await completeOutfitPhotographs(createdOutfits);
    } catch (error) {
      console.info("[Outfit Club looks]", error instanceof Error ? error.message : "unknown");
      showNotice("No se crearon los Looks", "Tu armario sigue intacto. Puedes reintentarlo.", "error");
    } finally {
      setOutfitGenerationProgress(null);
      setOutfitGenerating(false);
    }
  }

  async function createOutfitPhotograph(outfit: Outfit) {
    if (!cloudSession || outfitGenerating) return;
    if (!localAvatarUri && !cloudAvatar) {
      setSelectedOutfit(null);
      setAvatarOpen(true);
      return;
    }
    if (!codexConnected) {
      Alert.alert(
        "Conecta tu cuenta para crear esta foto",
        "La conexión sólo se utiliza mientras creamos la imagen con las prendas elegidas.",
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Conectar", onPress: connectCodexExperiment },
        ],
      );
      return;
    }
    setOutfitGenerating(true);
    try {
      await completeOutfitPhotographs([outfit]);
    } finally {
      setOutfitGenerationProgress(null);
      setOutfitGenerating(false);
    }
  }

  async function completeOutfitPhotographs(targets: Outfit[]) {
    let completed = 0;
    let failed = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const outfit = targets[index];
      setOutfitGenerationProgress({ current: index + 1, total: targets.length });
      try {
        const { renderPath, localRenderUri } = await renderOutfitPhotograph(outfit);
        const freshRenderPath = `${renderPath}?v=${Date.now()}`;
        setOutfits((current) => current.map((entry) => entry.id === outfit.id
          ? { ...entry, renderPath: freshRenderPath, localRenderUri, status: "ready" }
          : entry));
        setSelectedOutfit((current) => current?.id === outfit.id
          ? { ...current, renderPath: freshRenderPath, localRenderUri, status: "ready" }
          : current);
        completed += 1;
      } catch (error) {
        failed += 1;
        const detail = error instanceof Error ? error.message : "unknown";
        if (/codex_not_connected|token_refresh|401/u.test(detail)) {
          setCodexConnected(false);
          failed += targets.length - index - 1;
          break;
        }
      }
    }
    if (completed > 0 && cloudSession) await loadOutfits(cloudSession).catch(() => undefined);
    if (completed === targets.length) {
      showNotice(targets.length === 1 ? "Tu Look está listo" : "Tus Looks están listos", `${completed} ${completed === 1 ? "foto quedó guardada" : "fotos quedaron guardadas"} en Looks.`, "success");
    } else if (completed > 0) {
      showNotice("Looks parcialmente listos", `${completed} de ${targets.length} quedaron listos. Puedes reintentar los demás.`, "error");
    } else {
      showNotice("Las fotos no terminaron", failed > 0
        ? "Las combinaciones siguen guardadas. Revisa tu conexión y toca Crear fotos para reintentarlas."
        : "Las combinaciones siguen guardadas y se pueden reintentar.", "error");
    }
  }

  async function renderOutfitPhotograph(outfit: Outfit) {
    if (!cloudSession || !FileSystem.cacheDirectory) throw new Error("outfit_cloud_unavailable");
    const startedAt = Date.now();
    const temporaryPaths: string[] = [];
    let usageReservationId: string | null = null;
    try {
      usageReservationId = await reserveLookGeneration(`saved-look:${outfit.id}:${Date.now()}`);
      const avatarPreparationStartedAt = Date.now();
      const avatarBase64 = await accountAvatarBase64();
      const avatarPreparationMs = Date.now() - avatarPreparationStartedAt;
      const garmentPreparationStartedAt = Date.now();
      let garmentCacheHits = 0;
      let garmentCacheMisses = 0;
      const garmentInputs = [];
      for (const item of outfit.pieces.filter((piece) => piece.imagePath && piece.imageKind === "cutout")) {
        const cacheKey = `${item.id}:${item.imagePath}`;
        let imageBase64 = tryOnGarmentBase64.current.get(cacheKey);
        if (imageBase64) {
          garmentCacheHits += 1;
        } else {
          garmentCacheMisses += 1;
          const localPath = `${FileSystem.cacheDirectory}${TRY_ON_RENDER_PREFIX}-look-${item.id}.png`;
          await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
          const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${item.imagePath}`, localPath, {
            headers: {
              "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
              "x-vesta-device-token": cloudSession.deviceToken,
            },
            sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
          });
          if (download.status < 200 || download.status >= 300) throw new Error(`outfit_garment_download_${download.status}`);
          temporaryPaths.push(download.uri);
          imageBase64 = await prepareTryOnGarmentReference(download.uri);
          if (tryOnGarmentBase64.current.size >= 12) {
            const oldestKey = tryOnGarmentBase64.current.keys().next().value;
            if (oldestKey) tryOnGarmentBase64.current.delete(oldestKey);
          }
          tryOnGarmentBase64.current.set(cacheKey, imageBase64);
        }
        garmentInputs.push({
          name: item.name,
          type: item.type,
          color: item.color,
          description: item.description,
          placement: imagePlacementFor(item),
          imageBase64,
        });
      }
      if (!garmentInputs.length) throw new Error("outfit_cutouts_missing");
      const garmentPreparationMs = Date.now() - garmentPreparationStartedAt;
      const generated = await generateExperimentalTryOnImage(avatarBase64, garmentInputs, "low");
      const cloudUploadStartedAt = Date.now();
      const renderPath = await uploadOutfitRender(cloudSession, outfit.id, generated.imageBase64, usageReservationId);
      usageReservationId = null;
      const cloudUploadMs = Date.now() - cloudUploadStartedAt;
      const localRenderUri = outfitCachePath(cloudSession, outfit.id);
      const localSaveStartedAt = Date.now();
      if (localRenderUri) {
        await FileSystem.writeAsStringAsync(localRenderUri, generated.imageBase64, { encoding: FileSystem.EncodingType.Base64 });
      }
      const localSaveMs = Date.now() - localSaveStartedAt;
      await recordAvatarGenerationAudit({
        recordedAt: new Date().toISOString(),
        flow: "saved_look",
        status: "completed",
        quality: "low",
        garmentCount: garmentInputs.length,
        garmentCacheHits,
        garmentCacheMisses,
        ...generated.metrics,
        avatarPreparationMs,
        garmentPreparationMs,
        cloudUploadMs,
        localSaveMs,
        totalMs: Date.now() - startedAt,
      });
      return { renderPath, localRenderUri };
    } catch (error) {
      if (usageReservationId) await releaseUsageReservation(usageReservationId).catch(() => undefined);
      throw error;
    } finally {
      await Promise.all(temporaryPaths.map((path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined)));
    }
  }

  async function offerPendingExperimentalAnalysis(session: CloudSession) {
    const batchesResponse = await cloudFetch(session, "/api/v1/batches", { method: "GET" });
    if (!batchesResponse.ok) return;
    const payload = await batchesResponse.json() as { batches?: Array<{ id: string; status: string }> };
    const pendingBatch = payload.batches?.find((batch) => batch.status === "uploaded" || batch.status === "failed");
    if (!pendingBatch) return;
    setImportStage("analyzing");
    setImportMessage("Reanudando el análisis pendiente…");
    await retryCloudBatch(session, pendingBatch.id);
  }

  async function retryCloudBatch(session: CloudSession, batchId: string) {
    try {
      const response = await cloudFetch(session, `/api/v1/batches/${batchId}`, { method: "GET" });
      if (!response.ok) throw await uploadError("pending_batch", response);
      const payload = await response.json() as {
        photos?: Array<{ id: string; filename: string; contentType: string; sizeBytes: number; width: number | null; height: number | null; downloadPath: string }>;
      };
      if (!payload.photos?.length || !FileSystem.cacheDirectory) throw new Error("pending_photos_missing");
      const selectedPhotos: ExperimentalPhoto[] = [];
      for (const photo of payload.photos) {
        const extension = photo.filename.split(".").pop()?.replace(/[^a-z0-9]/giu, "") || "jpg";
        const localPath = `${FileSystem.cacheDirectory}vesta-${photo.id}.${extension}`;
        const download = await FileSystem.downloadAsync(`${session.apiUrl}${photo.downloadPath}`, localPath, {
          headers: {
            "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
            "x-vesta-device-token": session.deviceToken,
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        if (download.status < 200 || download.status >= 300) throw new Error(`download_${download.status}`);
        selectedPhotos.push({
          id: photo.id,
          asset: {
            uri: download.uri,
            width: photo.width || 1600,
            height: photo.height || 1600,
            fileName: photo.filename,
            fileSize: photo.sizeBytes,
            mimeType: photo.contentType,
            type: "image",
          },
        });
      }
      const completed = await startExperimentalProcessing(batchId, selectedPhotos);
      if (completed && pendingImport?.batchId === batchId) {
        await clearImportQueue(pendingImport);
        setPendingImport(null);
        setPhotos([]);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.info("[Outfit Club pending analysis]", detail);
      setImportStage("error");
      setImportMessage("No pudimos reanudar el análisis todavía. Tus fotos siguen seguras en tu cuenta.");
    }
  }

  const pickPhotos = async () => {
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showNotice("Permiso necesario", "Activa Fotos para seleccionar las prendas que quieras importar.", "error");
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
        setImportStage("staging");
        setImportMessage("Preparando tus fotos de forma segura…");
        if (pendingImport) await clearImportQueue(pendingImport);
        const queue = await stageImportQueue(result.assets);
        setPendingImport(queue);
        setPhotos(queue.photos.map((photo) => photo.asset));
        setImportOpen(false);
        setImportMessage(cloudSession ? "Subiendo tus fotos…" : "Esperando la conexión privada…");
        setImportStage("waiting");
        importResumeStarted.current = false;
        if (cloudSession) {
          importResumeStarted.current = true;
          await uploadBatch(queue);
        }
      }
    } catch (error) {
      console.info("[Outfit Club import staging]", error instanceof Error ? error.message : "unknown");
      setImportStage("error");
      setImportMessage("No pudimos preparar estas fotos. Tus originales siguen intactos; inténtalo otra vez.");
    } finally {
      setPicking(false);
    }
  };

  const pickAvatarReference = async (kind: "selfie" | "body") => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showNotice("Permiso necesario", "Activa Fotos para elegir la referencia de tu avatar.", "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      selectionLimit: 1,
      quality: 1,
      exif: false,
      base64: false,
    });
    if (result.canceled || !result.assets[0]) return;
    await discardAvatarDraft();
    if (kind === "selfie") setAvatarSelfie(result.assets[0]);
    else setAvatarFullBody(result.assets[0]);
  };

  const discardAvatarDraft = async () => {
    const previous = avatarDraftUri;
    avatarDraftBase64.current = null;
    setAvatarDraftUri(null);
    if (previous) await FileSystem.deleteAsync(previous, { idempotent: true }).catch(() => undefined);
  };

  const generateAvatarDraft = async () => {
    if (!avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating) return;
    if (!codexConnected) {
      Alert.alert(
        "Conecta tu cuenta para crear tu avatar",
        "Tus referencias se utilizan sólo durante la creación y el resultado queda en tu cuenta privada.",
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Conectar", onPress: connectCodexExperiment },
        ],
      );
      return;
    }
    if (!FileSystem.cacheDirectory) return;
    setAvatarGenerating(true);
    try {
      const result = await generateExperimentalAvatarImage(avatarSelfie, avatarFullBody);
      const draftPath = `${FileSystem.cacheDirectory}vesta-avatar-draft-${Date.now()}.png`;
      await FileSystem.writeAsStringAsync(draftPath, result, { encoding: FileSystem.EncodingType.Base64 });
      await discardAvatarDraft();
      avatarDraftBase64.current = result;
      setAvatarDraftUri(draftPath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      if (/codex_not_connected|token_refresh|401/u.test(detail)) setCodexConnected(false);
      console.info("[Outfit Club avatar]", detail);
      showNotice("El avatar no terminó", "Tus fotos siguen en este teléfono. Puedes reintentarlo.", "error");
    } finally {
      setAvatarGenerating(false);
    }
  };

  const saveAvatarDraft = async () => {
    if (!cloudSession || !avatarDraftBase64.current || avatarSaving) return;
    setAvatarSaving(true);
    try {
      const avatar = await uploadAccountAvatar(cloudSession, avatarDraftBase64.current);
      const cachedPath = avatarCachePath(cloudSession);
      if (cachedPath) {
        await FileSystem.writeAsStringAsync(cachedPath, avatarDraftBase64.current, { encoding: FileSystem.EncodingType.Base64 });
        setLocalAvatarUri(cachedPath);
      }
      setCloudAvatar(avatar);
      tryOnAvatarBase64.current = null;
      await discardAvatarDraft();
      setAvatarSelfie(null);
      setAvatarFullBody(null);
      setAvatarConsent(false);
      setAvatarOpen(false);
      setProfileOpen(false);
      showNotice("Avatar guardado", "Ya puedes probar prendas y generar Looks.", "success");
    } catch (error) {
      console.info("[Outfit Club avatar save]", error instanceof Error ? error.message : "unknown");
      showNotice("No se guardó el avatar", "El borrador sigue disponible para reintentar.", "error");
    } finally {
      setAvatarSaving(false);
    }
  };

  const deleteAccountAvatar = () => {
    if (!cloudSession || (!cloudAvatar && !localAvatarUri)) return;
    Alert.alert(
      "¿Eliminar tu avatar?",
      "Tus Looks terminados seguirán guardados como fotografías históricas. Solo se eliminará el avatar base actual.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            const response = await cloudFetch(cloudSession, "/api/v1/avatar", { method: "DELETE" });
            if (!response.ok) {
              showNotice("No se eliminó", "Vuelve a intentarlo cuando la cuenta esté sincronizada.", "error");
              return;
            }
            const cachedPath = avatarCachePath(cloudSession);
            if (cachedPath) await FileSystem.deleteAsync(cachedPath, { idempotent: true }).catch(() => undefined);
            setCloudAvatar(null);
            setLocalAvatarUri(null);
            tryOnAvatarBase64.current = null;
            await clearTryOn();
            setAvatarOpen(false);
            showNotice("Avatar eliminado", "Tus Looks guardados permanecen intactos.", "success");
          },
        },
      ],
    );
  };

  const pasteProductUrl = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (!value) {
      showNotice("No hay un enlace copiado", "Copia primero la página del producto.");
      return;
    }
    setProductUrl(value);
  };

  const importProductFromUrl = async () => {
    if (productImporting) return;
    if (!cloudSession) {
      showNotice("Preparando tu cuenta", "La importación comenzará cuando termine la conexión privada.");
      return;
    }
    if (!productUrl.trim()) {
      showNotice("Pega el enlace del producto", "Aceptamos prendas de cualquier tienda pública.");
      return;
    }
    setProductImporting(true);
    try {
      const response = await cloudFetch(cloudSession, "/api/v1/garments/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: productUrl.trim(), placement: productPlacement }),
      });
      const payload = await response.json() as { error?: string; garment?: CloudGarment };
      if (!response.ok || !payload.garment) throw new Error(payload.error || "product_import_failed");
      const item: WardrobeItem = { ...payload.garment, category: categoryForUi(payload.garment.category) };
      setCloudWardrobe((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
      const previousLayers = tryOnLayers;
      const fittingSlot = fittingSlotFor(item);
      const nextLayers = [
        ...previousLayers.filter((layer) => layer.item.id !== item.id && (fittingSlot === "accessory" || fittingSlotFor(layer.item) !== fittingSlot)),
        { key: `${item.id}-web-${Date.now()}`, item },
      ];
      setTryOnLayers(nextLayers);
      setSelectedItem(null);
      setLinkImportOpen(false);
      setProductUrl("");
      setProductPlacement("auto");
      setView("builder");

      if (!localAvatarUri && !cloudAvatar) {
        Alert.alert("Prenda guardada", "Ya está en tu armario. Crea tu avatar para verla puesta.", [
          { text: "Después", style: "cancel" },
          { text: "Crear avatar", onPress: () => setAvatarOpen(true) },
        ]);
      } else {
        showNotice("Prenda añadida al outfit", "Combínala y toca “Probar outfit” cuando esté listo.", "success");
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "product_import_failed";
      showNotice("No pudimos leer esa prenda", productImportErrorMessage(code), "error");
    } finally {
      setProductImporting(false);
    }
  };

  const connectCodexExperiment = async () => {
    if (codexConnecting) return;
    setCodexConnecting(true);
    try {
      const pending = await beginDeviceAuthorization();
      await Clipboard.setStringAsync(pending.userCode);
      const shouldContinue = await new Promise<boolean>((resolve) => Alert.alert(
        "Código de OpenAI copiado",
        `${pending.userCode}\n\nPulsa “Abrir OpenAI”, pega el código y autoriza esta prueba. Después vuelve a Outfit Club.`,
        [
          { text: "Cancelar", style: "cancel", onPress: () => resolve(false) },
          { text: "Abrir OpenAI", onPress: () => resolve(true) },
        ],
        { cancelable: false },
      ));
      if (!shouldContinue) return;
      await Linking.openURL(CODEX_DEVICE_URL);
      await completeDeviceAuthorization(pending);
      setCodexConnected(true);
      showNotice("Conexión lista", "Ya puedes crear tu avatar y tus Looks.", "success");
    } catch {
      showNotice("No se completó la conexión", "Puedes volver a intentarlo.", "error");
    } finally {
      setCodexConnecting(false);
    }
  };

  const disconnectCodexExperiment = async () => {
    await logoutCodex();
    setCodexConnected(false);
    showNotice("Cuenta desconectada", "La sesión se eliminó de este iPhone.", "success");
  };

  const uploadBatch = async (queueOverride?: PendingImportQueue) => {
    const initialQueue = queueOverride || pendingImport;
    if (!initialQueue) return;
    let queue: PendingImportQueue = initialQueue;
    if (!cloudSession) {
      setImportOpen(false);
      setImportStage("waiting");
      setImportMessage("Esperando la conexión privada para continuar automáticamente…");
      if (!automaticCloudConnectionStarted.current) {
        automaticCloudConnectionStarted.current = true;
        setPairing(true);
        await Linking.openURL(CLOUD_CONNECT_URL).catch(() => {
          automaticCloudConnectionStarted.current = false;
          setPairing(false);
        });
      }
      return;
    }

    setUploading(true);
    setImportStage("uploading");
    setImportMessage("Subiendo tus fotos en segundo plano…");
    setUploadProgress(0);
    try {
      if (queue.batchId) {
        const resumeResponse = await cloudFetch(cloudSession, `/api/v1/batches/${queue.batchId}`, { method: "GET" });
        if (resumeResponse.ok) {
          const resume = await resumeResponse.json() as { photos?: Array<{ id: string; status: string }> };
          const uploadedIds = new Set((resume.photos || []).filter((photo) => photo.status !== "awaiting_upload").map((photo) => photo.id));
          queue = {
            ...queue,
            photos: queue.photos.map((photo) => ({ ...photo, uploaded: Boolean(photo.uploadId && uploadedIds.has(photo.uploadId)) })),
            updatedAt: new Date().toISOString(),
          };
          setPendingImport(queue);
          await persistImportQueue(queue);
        }
      }

      const manifest = queue.photos.map((photo, index) => ({
        filename: photo.asset.fileName || `foto-${index + 1}.${extensionFor(photo.asset)}`,
        contentType: mimeTypeFor(photo.asset),
        sizeBytes: photo.asset.fileSize,
        width: photo.asset.width,
        height: photo.asset.height,
      }));

      if (!queue.batchId) {
        const batchResponse = await cloudFetch(cloudSession, "/api/v1/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: manifest, originalsPolicy: "retain_private" }),
        });
        if (!batchResponse.ok) throw await uploadError("batch", batchResponse);
        const batch = await batchResponse.json() as { batchId: string; photos: Array<{ id: string; uploadPath: string }> };
        queue = {
          ...queue,
          batchId: batch.batchId,
          photos: queue.photos.map((photo, index) => ({
            ...photo,
            uploadId: batch.photos[index].id,
            uploadPath: batch.photos[index].uploadPath,
          })),
          updatedAt: new Date().toISOString(),
        };
        setPendingImport(queue);
        await persistImportQueue(queue);
      }

      const completedIds = new Set(queue.photos.filter((photo) => photo.uploaded && photo.uploadId).map((photo) => photo.uploadId!));
      setUploadProgress(Math.round((completedIds.size / queue.photos.length) * 100));
      const remaining = queue.photos.filter((photo) => !photo.uploaded);
      await runImportPool(remaining, async (photo) => {
        if (!photo.uploadId || !photo.uploadPath) throw new Error("import_upload_path_missing");
        let uploaded = false;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 2 && !uploaded; attempt += 1) {
          try {
            const uploadResponse = await FileSystem.uploadAsync(
              `${cloudSession.apiUrl}${photo.uploadPath}`,
              photo.asset.uri,
              {
                httpMethod: "PUT",
                uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
                sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
                headers: {
                  "Content-Type": mimeTypeFor(photo.asset),
                  "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
                  "x-vesta-device-token": cloudSession.deviceToken,
                },
              },
            );
            if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
              throw uploadResultError("photo", uploadResponse.status, uploadResponse.body);
            }
            uploaded = true;
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("photo_upload_failed");
          }
        }
        if (!uploaded) throw lastError || new Error("photo_upload_failed");
        completedIds.add(photo.uploadId);
        queue = {
          ...queue,
          photos: queue.photos.map((entry) => ({ ...entry, uploaded: Boolean(entry.uploadId && completedIds.has(entry.uploadId)) })),
          updatedAt: new Date().toISOString(),
        };
        setPendingImport(queue);
        setUploadProgress(Math.round((completedIds.size / queue.photos.length) * 100));
        await persistImportQueue(queue);
      });

      setImportOpen(false);
      setImportStage("analyzing");
      setImportMessage("Buscando prendas claras y evitando duplicados…");
      const experimentalPhotos: ExperimentalPhoto[] = queue.photos.map((photo) => ({
        id: photo.uploadId!,
        asset: photo.asset,
      }));
      const completed = codexConnected
        ? await startExperimentalProcessing(queue.batchId!, experimentalPhotos)
        : await startProcessing(queue.batchId!, "economy");
      if (completed) {
        await clearImportQueue(queue);
        setPendingImport(null);
        setPhotos([]);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.info("[Outfit Club import upload]", detail);
      setImportStage("error");
      setImportMessage("La importación se pausó. Tus fotos están seguras y puedes continuar sin elegirlas otra vez.");
      if (detail.includes("_401_") || detail.includes("_403_")) {
        await Promise.all(Object.values(cloudKeys).map((key) => SecureStore.deleteItemAsync(key)));
        setCloudSession(null);
        automaticCloudConnectionStarted.current = true;
        setPairing(true);
        Linking.openURL(CLOUD_CONNECT_URL).catch(() => {
          automaticCloudConnectionStarted.current = false;
          setPairing(false);
        });
      }
    } finally {
      setUploading(false);
      importResumeStarted.current = false;
    }
  };

  const startExperimentalProcessing = async (batchId: string, selectedPhotos: ExperimentalPhoto[]) => {
    if (!cloudSession || processing) return false;
    setProcessing(true);
    setImportStage("analyzing");
    setImportMessage("Detectando únicamente prendas visibles con claridad…");
    setExperimentalProgress(0);
    try {
      const persistedByCandidate = new Map<string, { id: string; candidateKey: string }>();
      let detectedGarmentCount = 0;
      const analysis = await analyzeExperimentalInventory(selectedPhotos, async (completed, total, chunkResult, chunkUsage) => {
        setExperimentalProgress(Math.round((completed / total) * 70));
        const response = await cloudFetch(cloudSession, `/api/v1/batches/${batchId}/experimental-inventory`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "chatgpt-codex-experimental",
            model: EXPERIMENTAL_CODEX_MODEL,
            consent: true,
            results: [chunkResult],
            usage: chunkUsage,
            incremental: true,
            final: completed === total,
            chunkIndex: completed,
            chunkTotal: total,
          }),
        });
        const partial = await response.json() as {
          error?: string;
          detail?: string;
          garmentCount?: number;
          garments?: Array<{ id: string; candidateKey: string }>;
        };
        if (!response.ok) throw new Error(partial.detail ? `${partial.error || "experimental_inventory_failed"}: ${partial.detail}` : partial.error || "experimental_inventory_failed");
        detectedGarmentCount = partial.garmentCount ?? detectedGarmentCount;
        for (const garment of partial.garments || []) persistedByCandidate.set(garment.candidateKey, garment);
        await loadWardrobe(cloudSession);
        setImportMessage(completed === total
          ? `${detectedGarmentCount} prendas encontradas. Preparando sus imágenes…`
          : `${detectedGarmentCount} prendas disponibles mientras revisamos las fotos restantes…`);
      });
      setExperimentalProgress(82);
      const candidates = new Map(analysis.results.flatMap((item) => item.garments).map((item) => [item.candidate_key, item]));
      const photosById = new Map(selectedPhotos.map((photo) => [photo.id, photo]));
      const persistedGarments = Array.from(new Map(
        Array.from(persistedByCandidate.values()).map((garment) => [garment.id, garment]),
      ).values());
      const eligible = persistedGarments.filter((item) => {
        const candidate = candidates.get(item.candidateKey);
        return candidate && candidate.visibility === "clear" && candidate.confidence >= 85 && !candidate.is_basic && candidate.evidence.length > 0;
      });
      const basicCount = persistedGarments.filter((item) => candidates.get(item.candidateKey)?.is_basic).length;
      let generatedCount = 0;
      for (let index = 0; index < eligible.length; index += 1) {
        const persisted = eligible[index];
        const candidate = candidates.get(persisted.candidateKey)!;
        const evidence = candidate.evidence.reduce((best, item) => {
          const area = item.bbox.width * item.bbox.height;
          const bestArea = best.bbox.width * best.bbox.height;
          return area > bestArea ? item : best;
        });
        const photo = photosById.get(evidence.photo_id);
        if (!photo) continue;
        try {
          const image = await generateExperimentalGarmentImage(photo, candidate);
          await uploadExperimentalGarmentImage(cloudSession, persisted.id, image);
          generatedCount += 1;
          await loadWardrobe(cloudSession);
          setImportMessage(`${generatedCount} de ${eligible.length} prendas preparadas. Ya puedes revisar las disponibles.`);
        } catch {
          // The evidence image remains available when one catalog generation fails.
        }
        setExperimentalProgress(85 + Math.round(((index + 1) / Math.max(eligible.length, 1)) * 15));
      }
      setExperimentalProgress(100);
      await loadWardrobe(cloudSession);
      setImportStage("complete");
      setImportMessage(`${detectedGarmentCount} prendas añadidas. ${basicCount ? `${basicCount} básicas se conservaron sin generar otra imagen.` : "Tu armario está listo."}`);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.info("[Outfit Club inventory analysis]", detail);
      setImportStage("error");
      setImportMessage("El análisis se pausó. Tus fotos siguen seguras y puedes reanudarlo sin volver a elegirlas.");
      return false;
    } finally {
      setExperimentalProgress(0);
      setProcessing(false);
    }
  };

  const startProcessing = async (batchId: string, mode: "economy" | "quality") => {
    if (!cloudSession || processing) return false;
    setProcessing(true);
    setImportStage("analyzing");
    setImportMessage("Detectando únicamente prendas visibles con claridad…");
    try {
      const response = await cloudFetch(cloudSession, `/api/v1/batches/${batchId}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, consent: true, acknowledgesOpenAIRetention: true }),
      });
      const result = await response.json() as { error?: string; garmentCount?: number; duplicateCount?: number; deduplicationStatus?: string };
      if (response.status === 503 && result.error === "processing_not_configured") {
        setImportStage("error");
        setImportMessage("El análisis está temporalmente en pausa. Tus fotos quedaron guardadas y podrás reintentarlo.");
        return false;
      }
      if (!response.ok) throw new Error(result.error || "processing_failed");
      await loadWardrobe(cloudSession);
      setImportStage("complete");
      setImportMessage(`${result.garmentCount ?? 0} prendas añadidas a tu armario.`);
      return true;
    } catch (error) {
      console.info("[Outfit Club inventory processing]", error instanceof Error ? error.message : "unknown");
      setImportStage("error");
      setImportMessage("El análisis se pausó. Tus fotos siguen seguras y puedes continuar sin volver a subirlas.");
      return false;
    } finally {
      setProcessing(false);
    }
  };

  const chooseReconstruction = (item: WardrobeItem) => {
    if (item.isBasic) {
      showNotice("Básico reconocido", "Conservamos la foto real sin gastar una generación.");
      return;
    }
    if (codexConnected && item.evidencePath) {
      Alert.alert(
        "Crear imagen de catálogo",
        "Outfit Club aislará la prenda y quitará el fondo. La foto original seguirá guardada de forma privada para que puedas compararla.",
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Crear", onPress: () => startExperimentalReconstruction(item) },
        ],
      );
      return;
    }
    const heldNote = item.status === "held" ? " La evidencia es débil; si continúas, el resultado quedará obligado a revisión." : "";
    Alert.alert(
      "Crear imagen transparente",
      `Outfit Club preparará una sola prenda y comprobará el resultado contra tus fotos.${heldNote}`,
      [
        { text: "Ahora no", style: "cancel" },
        { text: "Borrador económico", onPress: () => startReconstruction(item, "draft") },
        { text: "Calidad final", onPress: () => startReconstruction(item, "final") },
      ],
    );
  };

  const startExperimentalReconstruction = async (item: WardrobeItem) => {
    if (!cloudSession || !item.evidencePath || reconstructingId) return;
    setReconstructingId(item.id);
    try {
      if (!FileSystem.cacheDirectory) throw new Error("image_cache_unavailable");
      const localPath = `${FileSystem.cacheDirectory}vesta-evidence-${item.id}.jpg`;
      const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${item.evidencePath}`, localPath, {
        headers: {
          "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
          "x-vesta-device-token": cloudSession.deviceToken,
        },
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      });
      if (download.status < 200 || download.status >= 300) throw new Error(`evidence_download_${download.status}`);
      try {
        const image = await generateExperimentalGarmentImage(
          { id: `evidence-${item.id}`, asset: { uri: download.uri, width: 1600, height: 1600, type: "image" } },
          {
            candidate_key: String(item.id),
            name: item.name,
            category: item.category,
            type: item.type,
            color: item.color,
            material: item.material || "",
            description: item.description || "",
            confidence: item.confidence || 70,
            is_basic: false,
            visibility: "clear",
            evidence: [{ photo_id: `evidence-${item.id}`, bbox: { x: 0, y: 0, width: 1000, height: 1000 } }],
          },
        );
        await uploadExperimentalGarmentImage(cloudSession, String(item.id), image);
      } finally {
        await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
      }
      const items = await loadWardrobe(cloudSession);
      const updated = items?.find((candidate) => candidate.id === item.id);
      if (updated) setSelectedItem(updated);
      showNotice("Imagen lista", "El recorte transparente ya está en tu armario.", "success");
    } catch (error) {
      console.info("[Outfit Club garment image]", error instanceof Error ? error.message : "unknown");
      showNotice("No se creó la imagen", "La foto original sigue intacta. Puedes reintentarlo.", "error");
    } finally {
      setReconstructingId(null);
    }
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
        showNotice("Imagen pendiente", "El procesamiento no está disponible todavía. No se realizó ningún cargo.", "error");
        return;
      }
      if (!response.ok) throw new Error(result.error || "reconstruction_failed");
      const items = await loadWardrobe(cloudSession);
      const refreshed = items?.find((entry) => entry.id === item.id);
      if (refreshed) setSelectedItem(refreshed);
      if (result.status === "approved") {
        showNotice("Imagen verificada", "La prenda ya está lista para usar.", "success");
      } else {
        showNotice("Necesita revisión", "Conservamos la foto original para que puedas comparar el resultado.");
      }
    } catch {
      showNotice("No se creó la imagen", "La prenda y sus fotos siguen intactas. Puedes reintentar.", "error");
    } finally {
      setReconstructingId(null);
    }
  };

  const ensureTryOnOutfit = async (layers: TryOnLayer[]) => {
    if (!cloudSession) throw new Error("outfit_cloud_unavailable");
    const response = await cloudFetch(cloudSession, "/api/v1/outfits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ garmentIds: layers.map((layer) => String(layer.item.id)) }),
    });
    const payload = await response.json() as { selectedOutfitId?: string; outfits?: CloudOutfit[]; error?: string };
    if (!response.ok) throw new Error(payload.error || `outfit_save_${response.status}`);
    if (!payload.selectedOutfitId) throw new Error("outfit_save_id_missing");
    if (payload.outfits) setOutfits((current) => mergeCachedOutfits(payload.outfits || [], current));
    return payload.selectedOutfitId;
  };

  const reserveLookGeneration = async (idempotencyKey: string) => {
    if (!cloudSession) throw new Error("outfit_cloud_unavailable");
    const response = await cloudFetch(cloudSession, "/api/v1/subscription/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reserve", kind: "look_generation", amount: 1, idempotencyKey }),
    });
    const payload = await response.json() as { reservationId?: string; metered?: boolean; error?: string };
    if (!response.ok) {
      if (response.status === 402 || response.status === 429) setPaywallOpen(true);
      throw new Error(payload.error || `look_usage_${response.status}`);
    }
    return payload.reservationId || null;
  };

  const releaseUsageReservation = async (reservationId: string) => {
    if (!cloudSession) return;
    await cloudFetch(cloudSession, "/api/v1/subscription/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", reservationId }),
    });
  };

  const saveTryOnRender = async (outfitId: string, imageBase64: string, usageReservationId?: string) => {
    if (!cloudSession) throw new Error("outfit_cloud_unavailable");
    await uploadOutfitRender(cloudSession, outfitId, imageBase64, usageReservationId || null);
    const localLookPath = outfitCachePath(cloudSession, outfitId);
    if (localLookPath) {
      await FileSystem.writeAsStringAsync(localLookPath, imageBase64, { encoding: FileSystem.EncodingType.Base64 }).catch(() => undefined);
    }
    await loadOutfits(cloudSession);
  };

  const renderRealTryOn = async (
    layers: TryOnLayer[],
    previousLayers: TryOnLayer[],
    quality: TryOnRenderQuality = "low",
    queuedJob?: PendingTryOnQueue,
  ) => {
    if (!cloudSession || !FileSystem.cacheDirectory || !FileSystem.documentDirectory) return;
    const startedAt = Date.now();
    tryOnResumeStarted.current = true;
    setTryOnRenderingQuality(quality);
    setTryOnRendering(true);
    const temporaryPaths: string[] = [];
    try {
      let queue: PendingTryOnQueue = queuedJob || {
        version: 1,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        deviceId: cloudSession.deviceId,
        garmentIds: layers.map((layer) => String(layer.item.id)),
        quality,
        updatedAt: new Date().toISOString(),
      };
      await persistTryOnQueue(queue);
      setPendingTryOn(queue);

      const outfitId = queue.outfitId || await ensureTryOnOutfit(layers);
      if (!queue.outfitId) {
        queue = { ...queue, outfitId, updatedAt: new Date().toISOString() };
        await persistTryOnQueue(queue);
        setPendingTryOn(queue);
      }

      if (!queue.usageReservationId) {
        const usageReservationId = await reserveLookGeneration(`try-on:${queue.id}`);
        queue = { ...queue, usageReservationId: usageReservationId || undefined, updatedAt: new Date().toISOString() };
        await persistTryOnQueue(queue);
        setPendingTryOn(queue);
      }

      let generatedImageBase64: string | null = null;
      if (queue.renderFileUri) {
        const rendered = await FileSystem.getInfoAsync(queue.renderFileUri).catch(() => null);
        if (rendered?.exists) {
          generatedImageBase64 = await FileSystem.readAsStringAsync(queue.renderFileUri, { encoding: FileSystem.EncodingType.Base64 });
          setTryOnRenderedUri(queue.renderFileUri);
          setTryOnRenderedSignature(tryOnSignatureFor(layers));
          setTryOnResultQuality(quality);
        }
      }

      if (generatedImageBase64) {
        await saveTryOnRender(outfitId, generatedImageBase64, queue.usageReservationId);
        setTryOnSavedOutfitId(outfitId);
        await clearTryOnQueue();
        setPendingTryOn(null);
        tryOnResumeStarted.current = false;
        showNotice("Look terminado", "La foto pendiente ya quedó guardada en Looks.", "success");
        return;
      }

      const avatarPreparationStartedAt = Date.now();
      const avatarBase64 = await accountAvatarBase64();
      const avatarPreparationMs = Date.now() - avatarPreparationStartedAt;
      const garmentPreparationStartedAt = Date.now();
      let garmentCacheHits = 0;
      let garmentCacheMisses = 0;
      const garmentInputs = [];
      for (const layer of layers) {
        const cacheKey = `${layer.item.id}:${layer.item.imagePath}`;
        let imageBase64 = tryOnGarmentBase64.current.get(cacheKey);
        if (imageBase64) {
          garmentCacheHits += 1;
        } else {
          garmentCacheMisses += 1;
          const localPath = `${FileSystem.cacheDirectory}${TRY_ON_RENDER_PREFIX}-${layer.item.id}.png`;
          await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
          const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${layer.item.imagePath}`, localPath, {
            headers: {
              "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
              "x-vesta-device-token": cloudSession.deviceToken,
            },
            sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
          });
          if (download.status < 200 || download.status >= 300) throw new Error(`try_on_garment_download_${download.status}`);
          temporaryPaths.push(download.uri);
          imageBase64 = await prepareTryOnGarmentReference(download.uri);
          if (tryOnGarmentBase64.current.size >= 12) {
            const oldestKey = tryOnGarmentBase64.current.keys().next().value;
            if (oldestKey) tryOnGarmentBase64.current.delete(oldestKey);
          }
          tryOnGarmentBase64.current.set(cacheKey, imageBase64);
        }
        garmentInputs.push({
          name: layer.item.name,
          type: layer.item.type,
          color: layer.item.color,
          description: layer.item.description,
          placement: imagePlacementFor(layer.item),
          imageBase64,
        });
      }
      const garmentPreparationMs = Date.now() - garmentPreparationStartedAt;
      const generated = await generateExperimentalTryOnImage(avatarBase64, garmentInputs, quality);
      const outputPath = `${FileSystem.documentDirectory}${TRY_ON_RENDER_PREFIX}-${Date.now()}.png`;
      const localSaveStartedAt = Date.now();
      await FileSystem.writeAsStringAsync(outputPath, generated.imageBase64, { encoding: FileSystem.EncodingType.Base64 });
      const localSaveMs = Date.now() - localSaveStartedAt;
      const previousRender = tryOnRenderedUri;
      setTryOnRenderedUri(outputPath);
      setTryOnRenderedSignature(tryOnSignatureFor(layers));
      setTryOnResultQuality(quality);
      queue = { ...queue, renderFileUri: outputPath, updatedAt: new Date().toISOString() };
      await persistTryOnQueue(queue);
      setPendingTryOn(queue);
      if (previousRender?.startsWith("file:")) {
        await FileSystem.deleteAsync(previousRender, { idempotent: true }).catch(() => undefined);
      }
      const cloudSaveStartedAt = Date.now();
      let cloudUploadMs = 0;
      try {
        await saveTryOnRender(outfitId, generated.imageBase64, queue.usageReservationId);
        setTryOnSavedOutfitId(outfitId);
        cloudUploadMs = Date.now() - cloudSaveStartedAt;
        await clearTryOnQueue();
        setPendingTryOn(null);
        tryOnResumeStarted.current = false;
      } catch (error) {
        cloudUploadMs = Date.now() - cloudSaveStartedAt;
        setTryOnSavedOutfitId(null);
        throw error;
      }
      await recordAvatarGenerationAudit({
        recordedAt: new Date().toISOString(),
        flow: "builder",
        status: "completed",
        quality,
        garmentCount: garmentInputs.length,
        garmentCacheHits,
        garmentCacheMisses,
        ...generated.metrics,
        avatarPreparationMs,
        garmentPreparationMs,
        cloudUploadMs,
        localSaveMs,
        totalMs: Date.now() - startedAt,
      });
    } catch (error) {
      setTryOnLayers(previousLayers);
      const detail = error instanceof Error ? error.message : "unknown";
      if (detail === "avatar_required") {
        Alert.alert("Crea tu avatar primero", "El probador necesita una selfie y una foto de cuerpo completo.", [
          { text: "Después", style: "cancel" },
          { text: "Crear avatar", onPress: () => setAvatarOpen(true) },
        ]);
      } else if (/codex_not_connected|token_refresh|401/u.test(detail)) {
        setCodexConnected(false);
        showNotice("Vuelve a conectar tu cuenta", "La sesión expiró. Reconéctala desde tu perfil.", "error");
      } else if (detail === "moderation_blocked") {
        await clearTryOnQueue();
        setPendingTryOn(null);
        showNotice("No se pudo crear esta prueba", "Tu avatar y tus prendas siguen intactos.", "error");
      } else {
        console.info("[Outfit Club try-on]", detail);
        showNotice("Creación pausada", "Tu outfit quedó guardado y continuará automáticamente cuando vuelvas a abrir la app.", "error");
      }
    } finally {
      await Promise.all(temporaryPaths.map((path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined)));
      setTryOnRendering(false);
    }
  };

  useEffect(() => {
    if (!pendingTryOn || !cloudSession || tryOnRendering || tryOnResumeStarted.current) return;
    if (pendingTryOn.deviceId !== cloudSession.deviceId) {
      clearTryOnQueue().catch(() => undefined);
      setPendingTryOn(null);
      return;
    }
    if (!pendingTryOn.renderFileUri && (!codexConnected || (!localAvatarUri && !cloudAvatar))) return;
    if (wardrobeLoading) return;
    const wardrobeById = new Map(cloudWardrobe.map((item) => [String(item.id), item]));
    const queuedLayers = pendingTryOn.garmentIds
      .map((garmentId, index) => {
        const item = wardrobeById.get(garmentId);
        return item?.imagePath && item.imageKind === "cutout" ? { key: `${garmentId}-resume-${index}`, item } : null;
      })
      .filter((layer): layer is TryOnLayer => Boolean(layer));
    if (queuedLayers.length !== pendingTryOn.garmentIds.length) {
      clearTryOnQueue().catch(() => undefined);
      setPendingTryOn(null);
      showNotice("No se pudo reanudar", "Una de las prendas ya no está disponible en tu armario.", "error");
      return;
    }
    tryOnResumeStarted.current = true;
    setTryOnLayers(queuedLayers);
    setView("builder");
    renderRealTryOn(queuedLayers, queuedLayers, pendingTryOn.quality, pendingTryOn).catch(() => undefined);
  }, [
    pendingTryOn?.id,
    pendingTryOn?.updatedAt,
    cloudSession?.deviceId,
    codexConnected,
    cloudAvatar?.version,
    localAvatarUri,
    cloudWardrobe,
    wardrobeLoading,
    tryOnRendering,
    tryOnResumeEpoch,
  ]);

  const addToTryOn = (item: WardrobeItem) => {
    if (tryOnRendering) return;
    if (!cloudSession || !item.imagePath || item.imageKind !== "cutout") {
      showNotice("Imagen pendiente", "Prepara el recorte de esta prenda antes de usarla en tu avatar.");
      return;
    }
    const existing = tryOnLayers.find((layer) => layer.item.id === item.id);
    if (existing) {
      const nextLayers = tryOnLayers.filter((layer) => layer.item.id !== item.id);
      if (!nextLayers.length) {
        clearTryOn().catch(() => undefined);
      } else {
        setTryOnLayers(nextLayers);
        setTryOnSavedOutfitId(null);
      }
      setView("builder");
      return;
    }
    const key = `${item.id}-${Date.now()}`;
    const fittingSlot = fittingSlotFor(item);
    const previousLayers = tryOnLayers;
    const nextLayers = [
      ...previousLayers.filter((layer) => fittingSlot === "accessory" || fittingSlotFor(layer.item) !== fittingSlot),
      { key, item },
    ];
    setTryOnLayers(nextLayers);
    setTryOnSavedOutfitId(null);
    setSelectedItem(null);
    setView("builder");
  };

  const measureTryOnCanvas = () => {
    tryOnCanvasRef.current?.measureInWindow((x, y, width, height) => {
      tryOnCanvasWindow.current = { x, y, width, height };
    });
  };

  const pointIsOverBodyTarget = (item: WardrobeItem, x: number, y: number) => {
    const bounds = tryOnCanvasWindow.current;
    if (!bounds || x < bounds.x || x > bounds.x + bounds.width || y < bounds.y || y > bounds.y + bounds.height) return false;
    const relativeX = (x - bounds.x) / bounds.width;
    const relativeY = (y - bounds.y) / bounds.height;
    const region = bodyRegionFor(item);
    if (region === "head") return relativeX >= 0.15 && relativeX <= 0.85 && relativeY <= 0.28;
    if (region === "torso") return relativeX >= 0.08 && relativeX <= 0.92 && relativeY >= 0.12 && relativeY <= 0.63;
    if (region === "legs") return relativeX >= 0.12 && relativeX <= 0.88 && relativeY >= 0.38 && relativeY <= 0.88;
    return relativeX >= 0.1 && relativeX <= 0.9 && relativeY >= 0.72;
  };

  const beginWardrobeDrag = (item: WardrobeItem, x: number, y: number) => {
    measureTryOnCanvas();
    setWardrobeDrag({ item, x, y, overCanvas: pointIsOverBodyTarget(item, x, y) });
  };

  const moveWardrobeDrag = (x: number, y: number) => {
    setWardrobeDrag((current) => current ? { ...current, x, y, overCanvas: pointIsOverBodyTarget(current.item, x, y) } : null);
  };

  const finishWardrobeDrag = (item: WardrobeItem, x: number, y: number) => {
    if (pointIsOverBodyTarget(item, x, y)) addToTryOn(item);
    setWardrobeDrag(null);
  };

  const clearTryOn = async () => {
    if (tryOnRendering) return;
    const previousRender = tryOnRenderedUri;
    setTryOnLayers([]);
    setTryOnRenderedUri(null);
    setTryOnRenderedSignature(null);
    setTryOnResultQuality(null);
    setTryOnSavedOutfitId(null);
    if (previousRender?.startsWith("file:")) {
      await FileSystem.deleteAsync(previousRender, { idempotent: true }).catch(() => undefined);
    }
  };

  const removeTryOnLayer = (key: string) => {
    if (tryOnRendering) return;
    const nextLayers = tryOnLayers.filter((layer) => layer.key !== key);
    if (!nextLayers.length) {
      clearTryOn().catch(() => undefined);
      return;
    }
    setTryOnLayers(nextLayers);
    setTryOnSavedOutfitId(null);
  };

  const generateTryOnOutfit = () => {
    if (tryOnRendering || !tryOnLayers.length) return;
    if (!localAvatarUri && !cloudAvatar) {
      Alert.alert("Crea tu avatar primero", "Después podrás usarlo con una o varias prendas sin volver a configurarlo.", [
        { text: "Después", style: "cancel" },
        { text: "Crear avatar", onPress: () => setAvatarOpen(true) },
      ]);
      return;
    }
    if (!codexConnected) {
      Alert.alert(
        "Conecta tu cuenta para probar el outfit",
        "Puedes preparar combinaciones sin conexión. La conexión sólo se utiliza al crear la imagen vestida.",
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Conectar", onPress: connectCodexExperiment },
        ],
      );
      return;
    }
    renderRealTryOn(tryOnLayers, tryOnLayers, "low").catch(() => undefined);
  };

  const improveTryOnQuality = () => {
    if (tryOnRendering || !tryOnLayers.length) return;
    if (!codexConnected) {
      connectCodexExperiment();
      return;
    }
    renderRealTryOn(tryOnLayers, tryOnLayers, "medium").catch(() => undefined);
  };

  const trySavedOutfit = (outfit: Outfit) => {
    const readyPieces = outfit.pieces.filter((piece) => piece.imagePath && piece.imageKind === "cutout");
    if (!readyPieces.length) {
      showNotice("Prendas pendientes", "Prepara las imágenes restantes antes de abrir este Look.");
      return;
    }
    setTryOnLayers(readyPieces.map((item, index) => ({ key: `${item.id}-look-${index}`, item })));
    setTryOnSavedOutfitId(outfit.id);
    setSelectedOutfit(null);
    setView("builder");
  };

  const tryOnWardrobe = activeWardrobe.filter((item) => item.imagePath && item.imageKind === "cutout");
  const selectedTryOnSignature = tryOnSignatureFor(tryOnLayers);
  const tryOnHasPendingChanges = tryOnLayers.length > 0 && selectedTryOnSignature !== tryOnRenderedSignature;
  const pendingOutfitCount = outfits.filter((outfit) => !outfit.renderPath).length;
  const avatarDisplaySource = localAvatarUri
    ? { uri: localAvatarUri }
    : cloudAvatar && cloudSession ? authorizedImageSource(cloudSession, cloudAvatar.mediaPath) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View
        ref={appRootRef}
        style={styles.app}
        onLayout={() => appRootRef.current?.measureInWindow((x, y) => { appRootWindow.current = { x, y }; })}
      >
        {notice && (
          <Pressable
            style={[styles.notice, notice.tone === "error" && styles.noticeError, notice.tone === "success" && styles.noticeSuccess]}
            onPress={() => setNotice(null)}
            accessibilityRole="alert"
          >
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              {notice.message ? <Text style={styles.noticeMessage}>{notice.message}</Text> : null}
            </View>
            <Text style={styles.noticeClose}>×</Text>
          </Pressable>
        )}
        <View style={styles.topbar}>
          <Pressable onPress={() => setView("closet")} style={styles.brand} accessibilityLabel="Ir al armario">
            <View style={styles.brandMark}><Text style={styles.brandLetter}>OC</Text></View>
            <Text style={styles.brandName}>OUTFIT CLUB</Text>
          </Pressable>
            <View style={styles.cloudBadge}>
            <View style={cloudSession ? styles.greenDot : styles.rustDot} />
            <Text style={[styles.cloudBadgeText, !cloudSession && styles.cloudBadgePending]}>{tryOnRendering ? "VISTIENDO AVATAR…" : processing ? experimentalProgress ? `ANALIZANDO ${experimentalProgress}%` : "ANALIZANDO…" : reconstructingId ? "PREPARANDO PRENDA…" : cloudSession ? "CUENTA PROTEGIDA" : "PREPARANDO CUENTA…"}</Text>
          </View>
          <Pressable style={styles.avatar} onPress={() => setProfileOpen(true)} accessibilityLabel="Privacidad y perfil">
            {avatarDisplaySource
              ? <Image source={avatarDisplaySource} resizeMode="cover" style={styles.avatarThumb} />
              : <Text style={styles.avatarText}>YO</Text>}
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
                    <Text style={styles.eyebrow}>TU ARMARIO PRIVADO</Text>
                    <Text style={styles.pageTitle}>Armario <Text style={styles.count}>{activeWardrobe.length}</Text></Text>
                  </View>
                  <Pressable style={styles.importButton} onPress={() => setImportOpen(true)}>
                    <Text style={styles.importButtonText}>＋ Importar</Text>
                  </Pressable>
                </View>
                {importStage !== "idle" && (
                  <Pressable
                    style={[styles.batchBanner, importStage === "error" && styles.batchBannerError]}
                    onPress={() => {
                      if (importStage === "error" && pendingImport) setImportOpen(true);
                      else if (importStage === "complete") setImportStage("idle");
                    }}
                    disabled={!((importStage === "error" && pendingImport) || importStage === "complete")}
                  >
                    <View style={importStage === "error" ? styles.rustDot : styles.greenDot} />
                    <View style={styles.batchBannerText}>
                      <Text style={styles.batchTitle}>{importStage === "staging"
                        ? "Preparando fotos"
                        : importStage === "waiting"
                          ? "Importación en espera"
                          : importStage === "uploading"
                            ? `Subiendo ${uploadProgress}%`
                            : importStage === "analyzing"
                              ? experimentalProgress ? `Analizando ${experimentalProgress}%` : "Analizando tus fotos"
                              : importStage === "complete" ? "Armario actualizado" : "Importación pausada"}</Text>
                      <Text style={styles.batchMeta}>{importMessage}</Text>
                      {(importStage === "uploading" || importStage === "analyzing") && (
                        <View style={styles.importProgressTrack}>
                          <View style={[styles.importProgressFill, { width: `${importStage === "uploading" ? uploadProgress : Math.max(experimentalProgress, 8)}%` }]} />
                        </View>
                      )}
                    </View>
                    {(importStage === "error" || importStage === "complete") && <Text style={styles.reviewText}>{importStage === "error" ? "Reintentar" : "Ocultar"}</Text>}
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
            ListEmptyComponent={
              <View style={styles.emptyCollection}>
                <Text style={styles.emptyCollectionTitle}>Todavía no hay prendas.</Text>
                <Text style={styles.emptyCollectionCopy}>Importa fotos tuyas o pega el enlace de cualquier prenda que quieras probar.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable style={styles.garmentCard} onPress={() => setSelectedItem(item)}>
                <GarmentVisual item={item} session={cloudSession} />
                <View style={styles.cardCopy}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <Text style={styles.cardMeta}>{item.type} · {item.color} · {statusLabel(item.status)}</Text>
                </View>
                {tryOnLayers.some((layer) => layer.item.id === item.id) && <View style={styles.selectedDot}><Text style={styles.selectedDotText}>✓</Text></View>}
              </Pressable>
            )}
          />
        )}

        {view === "builder" && (
          <ScrollView contentContainerStyle={styles.builderScreen} scrollEnabled={!wardrobeDrag && !tryOnRendering}>
            <Text style={styles.eyebrow}>PROBADOR PERSONAL</Text>
            <View style={styles.tryOnHeadingRow}>
              <View style={styles.tryOnHeadingCopy}>
                <Text style={styles.tryOnTitle}>Pruébatelo.</Text>
                <Text style={styles.tryOnIntro}>Selecciona todas las prendas del outfit y genera una sola prueba cuando la combinación esté lista.</Text>
              </View>
              {tryOnLayers.length > 0 && (
                <Pressable onPress={() => clearTryOn().catch(() => undefined)} style={[styles.clearTryOnButton, tryOnRendering && styles.disabledButton]} disabled={tryOnRendering}>
                  <Text style={styles.clearTryOnText}>Limpiar</Text>
                </Pressable>
              )}
            </View>

            <Pressable
              style={[styles.webTryOnBanner, tryOnRendering && styles.disabledButton]}
              onPress={() => setLinkImportOpen(true)}
              disabled={tryOnRendering}
            >
              <View style={styles.webTryOnIcon}><Text style={styles.webTryOnIconText}>↗</Text></View>
              <View style={styles.webTryOnCopy}>
                <Text style={styles.webTryOnEyebrow}>¿VISTE ALGO EN INTERNET?</Text>
                <Text style={styles.webTryOnTitle}>Pega el link y combínalo</Text>
              </View>
              <Text style={styles.webTryOnArrow}>›</Text>
            </Pressable>

            <ScrollView horizontal scrollEnabled={!wardrobeDrag && !tryOnRendering} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.tryOnRail, tryOnRendering && styles.tryOnRailDisabled]} pointerEvents={tryOnRendering ? "none" : "auto"}>
              {tryOnWardrobe.map((item) => (
                <DraggableTryOnRailItem
                  key={String(item.id)}
                  item={item}
                  session={cloudSession}
                  active={tryOnLayers.some((layer) => layer.item.id === item.id)}
                  onPress={() => addToTryOn(item)}
                  onDragStart={beginWardrobeDrag}
                  onDragMove={moveWardrobeDrag}
                  onDragEnd={finishWardrobeDrag}
                />
              ))}
              {tryOnWardrobe.length === 0 && (
                <Pressable style={styles.tryOnRailEmpty} onPress={() => setView("closet")}>
                  <Text style={styles.tryOnRailEmptyText}>Primero crea los recortes transparentes de tus prendas.</Text>
                </Pressable>
              )}
            </ScrollView>

            <View
              ref={tryOnCanvasRef}
              style={styles.tryOnCanvas}
              onLayout={() => requestAnimationFrame(measureTryOnCanvas)}
            >
              <View style={styles.tryOnCanvasHalo} />
              {tryOnRenderedUri
                ? <Image source={{ uri: tryOnRenderedUri }} resizeMode="contain" style={styles.tryOnAvatarImage} />
                : avatarDisplaySource
                  ? <Image source={avatarDisplaySource} resizeMode="contain" style={styles.tryOnAvatarImage} />
                  : (
                    <Pressable style={styles.avatarPlaceholder} onPress={() => setAvatarOpen(true)}>
                      <Text style={styles.avatarPlaceholderIcon}>◇</Text>
                      <Text style={styles.avatarPlaceholderTitle}>CREA TU AVATAR</Text>
                      <Text style={styles.avatarPlaceholderCopy}>Selfie + cuerpo completo</Text>
                    </Pressable>
                  )}
              {wardrobeDrag && (() => {
                const region = bodyRegionFor(wardrobeDrag.item);
                return (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.bodyDropZone,
                      region === "head" && styles.bodyDropHead,
                      region === "torso" && styles.bodyDropTorso,
                      region === "legs" && styles.bodyDropLegs,
                      region === "feet" && styles.bodyDropFeet,
                      wardrobeDrag.overCanvas && styles.bodyDropZoneReady,
                    ]}
                  >
                    <Text style={[styles.bodyDropZoneText, wardrobeDrag.overCanvas && styles.bodyDropZoneTextReady]}>{bodyRegionLabel(region)}</Text>
                  </View>
                );
              })()}
              {tryOnRendering && (
                <View pointerEvents="none" style={styles.tryOnRenderingOverlay}>
                  <View style={styles.tryOnRenderingCard}>
                    <ActivityIndicator color={rust} size="large" />
                    <Text style={styles.tryOnRenderingTitle}>{tryOnRenderingQuality === "low" ? "Creando prueba rápida…" : "Mejorando el look…"}</Text>
                    <Text style={styles.tryOnRenderingCopy}>{tryOnRenderingQuality === "low" ? "Ajustando todas las prendas al cuerpo con el modo más veloz." : "Refinando tela, volumen, identidad y detalles en mejor calidad."}</Text>
                  </View>
                </View>
              )}
              {tryOnLayers.length === 0 && !tryOnRendering && avatarDisplaySource && (
                <View pointerEvents="none" style={styles.tryOnHint}>
                  <Text style={styles.tryOnHintIcon}>↓</Text>
                  <Text style={styles.tryOnHintText}>ELIGE UNA PRENDA</Text>
                </View>
              )}
              {tryOnHasPendingChanges && !tryOnRendering && (
                <View pointerEvents="none" style={styles.tryOnPendingBadge}>
                  <Text style={styles.tryOnPendingBadgeText}>{tryOnLayers.length} {tryOnLayers.length === 1 ? "PRENDA LISTA" : "PRENDAS LISTAS"}</Text>
                </View>
              )}
            </View>

            {tryOnLayers.length > 0 && (
              <View style={styles.tryOnSelectionPanel}>
                <View style={styles.tryOnSelectionHeading}>
                  <Text style={styles.tryOnControlEyebrow}>PRENDAS EN ESTE LOOK</Text>
                  <Text style={styles.tryOnQualityBadge}>{tryOnHasPendingChanges
                    ? "LISTO PARA PROBAR"
                    : tryOnSavedOutfitId ? "GUARDADO EN LOOKS" : tryOnResultQuality === "medium" ? "MEJOR CALIDAD" : "VISTA RÁPIDA"}</Text>
                </View>
                <View style={styles.tryOnSelectionChips}>
                  {tryOnLayers.map((layer) => (
                    <Pressable key={layer.key} style={[styles.tryOnSelectionChip, tryOnRendering && styles.disabledButton]} onPress={() => removeTryOnLayer(layer.key)} disabled={tryOnRendering}>
                      <Text style={styles.tryOnSelectionChipText}>{layer.item.name}</Text>
                      <Text style={styles.tryOnSelectionChipRemove}>×</Text>
                    </Pressable>
                  ))}
                </View>
                {tryOnHasPendingChanges && !tryOnRendering && (
                  <Pressable style={styles.generateTryOnOutfitButton} onPress={generateTryOnOutfit}>
                    <Text style={styles.generateTryOnOutfitButtonText}>Probar outfit · {tryOnLayers.length} {tryOnLayers.length === 1 ? "prenda" : "prendas"}</Text>
                  </Pressable>
                )}
                {!tryOnHasPendingChanges && tryOnResultQuality === "low" && !tryOnRendering && (
                  <Pressable style={styles.improveTryOnButton} onPress={improveTryOnQuality}>
                    <Text style={styles.improveTryOnButtonText}>✦ Mejorar este look</Text>
                  </Pressable>
                )}
              </View>
            )}
            <Text style={styles.tryOnFootnote}>Combina arriba, capa, pantalón, gorra y calzado antes de generar. Solo se hace una solicitud por outfit.</Text>
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
              <View>
                <View style={styles.headingRow}>
                  <View>
                    <Text style={styles.eyebrow}>TUS COMBINACIONES</Text>
                    <Text style={styles.pageTitle}>Looks <Text style={styles.count}>{outfits.length}</Text></Text>
                  </View>
                  <Pressable style={[styles.importButton, outfitGenerating && styles.disabledButton]} onPress={generateSavedOutfits} disabled={outfitGenerating || !cloudSession}>
                    <Text style={styles.importButtonText}>{outfitGenerating
                      ? outfitGenerationProgress ? `VISTIENDO ${outfitGenerationProgress.current}/${outfitGenerationProgress.total}…` : "PREPARANDO…"
                      : pendingOutfitCount ? "Crear fotos　✦" : "Generar　✦"}</Text>
                  </Pressable>
                </View>
                <Text style={styles.looksIntro}>Outfit Club arma el outfit y crea una foto realista de ti usándolo. Cada imagen terminada se guarda para no volver a generarla al abrirla.</Text>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.emptyCollection}>
                {outfitsLoading ? <ActivityIndicator color={rust} /> : <Text style={styles.emptyCollectionTitle}>Crea tus primeros Looks.</Text>}
                <Text style={styles.emptyCollectionCopy}>{outfitsLoading ? "Sincronizando tu colección privada…" : "Genera combinaciones completas y guárdalas automáticamente en tu cuenta."}</Text>
              </View>
            }
            renderItem={({ item }) => (
              <LookCard
                outfit={item}
                session={cloudSession}
                onOpen={() => setSelectedOutfit(item)}
                onPeek={() => setPeekedOutfit(item)}
                onPeekEnd={() => setPeekedOutfit(null)}
                showPieces={peekedOutfit?.id === item.id}
              />
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

        {wardrobeDrag && cloudSession && wardrobeDrag.item.imagePath && (
          <View
            pointerEvents="none"
            style={[
              styles.wardrobeDragGhost,
              wardrobeDrag.overCanvas && styles.wardrobeDragGhostReady,
              { left: wardrobeDrag.x - appRootWindow.current.x - 43, top: wardrobeDrag.y - appRootWindow.current.y - 43 },
            ]}
          >
            <Image source={authorizedImageSource(cloudSession, wardrobeDrag.item.imagePath)} resizeMode="contain" style={styles.wardrobeDragGhostImage} />
          </View>
        )}

      </View>

      <Modal visible={importOpen} transparent animationType="slide" onRequestClose={() => setImportOpen(false)}>
        <View style={styles.modalBackdrop}>
          <ScrollView style={styles.modalSheet} contentContainerStyle={styles.importModalContent} showsVerticalScrollIndicator={false}>
            <Pressable style={styles.closeButton} onPress={() => setImportOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <View style={styles.scanOrb}><Text style={styles.scanOrbText}>✦</Text></View>
            <Text style={[styles.eyebrow, styles.centerText]}>CARRETE DEL TELÉFONO</Text>
            <Text style={styles.modalTitle}>Elige las fotos para tu armario.</Text>
            <Text style={styles.modalIntro}>Al elegirlas, Outfit Club las guardará en tu cuenta privada y comenzará el análisis automáticamente. Puedes cerrar la app: la importación continuará o se reanudará después.</Text>
            <View style={styles.privacyPill}><View style={cloudSession ? styles.greenDot : styles.rustDot} /><Text style={styles.privacyPillText}>{cloudSession ? "CUENTA PRIVADA PROTEGIDA" : "PREPARANDO CUENTA PRIVADA"}</Text></View>

            <Pressable style={styles.webImportChoice} onPress={() => { setImportOpen(false); setLinkImportOpen(true); }}>
              <View style={styles.webImportChoiceIcon}><Text style={styles.webImportChoiceIconText}>↗</Text></View>
              <View style={styles.webImportChoiceCopy}>
                <Text style={styles.webImportChoiceTitle}>Importar desde un enlace</Text>
                <Text style={styles.webImportChoiceHint}>Gorra, playera, chamarra, pantalón o calzado</Text>
              </View>
              <Text style={styles.webImportChoiceArrow}>›</Text>
            </Pressable>
            <Text style={styles.importDivider}>O DESDE TUS FOTOS</Text>

            <Pressable style={styles.photoPicker} onPress={pickPhotos} disabled={picking || uploading || processing || importStage === "staging"}>
              {picking || importStage === "staging" ? <ActivityIndicator color="#A34F31" /> : <Text style={styles.photoPickerTitle}>{photos.length ? "Elegir otras fotos" : "Abrir carrete y comenzar"}</Text>}
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
                  <Text style={styles.photoSummaryTitle}>{photos.length} fotos protegidas para importar</Text>
                  <Text style={styles.photoSummaryMeta}>{formatBytes(photoBytes)} · progreso guardado en este iPhone</Text>
                </View>
                {importStage === "error" && pendingImport && (
                  <Pressable
                    style={styles.fullButton}
                    onPress={() => {
                      setImportOpen(false);
                      importResumeStarted.current = true;
                      uploadBatch(pendingImport).catch(() => undefined);
                    }}
                  >
                    <Text style={styles.fullButtonText}>Continuar importación</Text>
                  </Pressable>
                )}
                {(uploading || processing) && <Text style={styles.avatarPrivacyCopy}>{importMessage}</Text>}
                <Pressable
                  disabled={uploading || processing}
                  onPress={async () => {
                    await clearImportQueue(pendingImport);
                    setPendingImport(null);
                    setPhotos([]);
                    setImportStage("idle");
                    setImportMessage("");
                    setImportOpen(false);
                  }}
                >
                  <Text style={[styles.deleteText, (uploading || processing) && styles.disabledText]}>Cancelar importación</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={linkImportOpen} transparent animationType="slide" onRequestClose={() => !productImporting && setLinkImportOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Pressable style={styles.closeButton} onPress={() => setLinkImportOpen(false)} disabled={productImporting}><Text style={styles.closeText}>×</Text></Pressable>
            <View style={styles.scanOrb}><Text style={styles.scanOrbText}>↗</Text></View>
            <Text style={[styles.eyebrow, styles.centerText]}>PRENDA DE INTERNET</Text>
            <Text style={styles.modalTitle}>Pega el link. Outfit Club te la pone.</Text>
            <Text style={styles.modalIntro}>Importaremos la imagen pública del producto a tu armario privado y crearemos una prueba realista sobre tu avatar.</Text>

            <TextInput
              style={styles.productUrlInput}
              value={productUrl}
              onChangeText={setProductUrl}
              placeholder="https://tienda.com/producto"
              placeholderTextColor="#9B9386"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              editable={!productImporting}
              onSubmitEditing={() => importProductFromUrl().catch(() => undefined)}
              accessibilityLabel="Enlace de la prenda"
            />
            <Pressable style={styles.pasteLinkButton} onPress={() => pasteProductUrl().catch(() => undefined)} disabled={productImporting}>
              <Text style={styles.pasteLinkButtonText}>Pegar desde portapapeles</Text>
            </Pressable>

            <Text style={styles.productPlacementLabel}>¿DÓNDE VA?</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.productPlacementRow}>
              {productPlacements.map((option) => (
                <Pressable
                  key={option.id}
                  style={[styles.productPlacementChip, productPlacement === option.id && styles.productPlacementChipActive]}
                  onPress={() => setProductPlacement(option.id)}
                  disabled={productImporting}
                >
                  <Text style={[styles.productPlacementChipText, productPlacement === option.id && styles.productPlacementChipTextActive]}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              style={[styles.fullButton, styles.importProductButton, (!productUrl.trim() || productImporting) && styles.disabledButton]}
              onPress={() => importProductFromUrl().catch(() => undefined)}
              disabled={!productUrl.trim() || productImporting}
            >
              {productImporting ? <ActivityIndicator color={paper} /> : <Text style={styles.fullButtonText}>＋ Importar al outfit</Text>}
            </Pressable>
            <Text style={styles.productImportPrivacy}>Solo se lee la página pública que pegaste. La referencia importada queda protegida dentro de tu cuenta y también puede combinarse en Looks.</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={profileOpen} transparent animationType="slide" onRequestClose={() => setProfileOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.profileSheet}>
            <Pressable style={styles.closeButton} onPress={() => setProfileOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.profileAvatar}>
                {avatarDisplaySource
                  ? <Image source={avatarDisplaySource} resizeMode="cover" style={styles.profileAvatarImage} />
                  : <Text style={styles.profileAvatarText}>YO</Text>}
              </View>
              <Text style={[styles.eyebrow, styles.centerText]}>TU OUTFIT CLUB</Text>
              <Text style={styles.modalTitle}>Tu nube privada.</Text>
              <Text style={styles.modalIntro}>Cada cuenta tiene su propio avatar, armario y Looks. Las imágenes solo se entregan después de verificar el dispositivo.</Text>
              <View style={styles.architectureCard}>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>AVATAR</Text><Text style={avatarDisplaySource ? styles.architectureValue : styles.architecturePending}>{avatarDisplaySource ? "Listo y privado" : "Pendiente"}</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ORIGINALES</Text><Text style={styles.architectureValue}>Privados</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>PNG Y LOOKS</Text><Text style={styles.architectureValue}>Privados</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>DUPLICADOS APARTADOS</Text><Text style={styles.architectureValue}>{duplicateCount}</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ACCESO</Text><Text style={styles.architectureValue}>Solo esta cuenta</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>ESTADO</Text><Text style={cloudSession ? styles.architectureValue : styles.architecturePending}>{cloudSession ? "Protegida y sincronizada" : pairing ? "Preparando cuenta…" : "Configurando…"}</Text></View>
                <View style={styles.architectureRow}><Text style={styles.architectureLabel}>CHATGPT · PRUEBA</Text><Text style={codexConnected ? styles.architectureValue : styles.architecturePending}>{codexConnected ? "Conectado" : codexConnecting ? "Esperando autorización…" : "Desconectado"}</Text></View>
              </View>
              <Text style={styles.profileFootnote}>{cloudSession ? `${cloudWardrobe.length ? `${cloudWardrobe.length} prendas reales sincronizadas. ` : ""}El avatar y los Looks pertenecen automáticamente a esta cuenta; las copias locales permiten volver a verlos en este iPhone.` : "Outfit Club está creando automáticamente el espacio privado de esta cuenta."}</Text>
              <Pressable style={styles.premiumCard} onPress={() => { setProfileOpen(false); setPaywallOpen(true); }}>
                <View style={styles.premiumCardIcon}><Text style={styles.premiumCardIconText}>OC</Text></View>
                <View style={styles.premiumCardCopy}>
                  <Text style={styles.premiumCardEyebrow}>OUTFIT CLUB PREMIUM</Text>
                  <Text style={styles.premiumCardTitle}>Ver planes y administrar pagos</Text>
                </View>
                <Text style={styles.premiumCardArrow}>›</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => { setProfileOpen(false); setPrivacyOpen(true); }}>
                <Text style={styles.secondaryButtonText}>Política de privacidad</Text>
              </Pressable>
              {!cloudSession && (
                <Pressable style={[styles.fullButton, pairing && styles.disabledButton]} onPress={startCloudConnection} disabled={pairing}>
                  <Text style={styles.fullButtonText}>{pairing ? "Esperando conexión…" : "Conectar mi cuenta"}</Text>
                </Pressable>
              )}
              {!cloudSession && (
                <Pressable style={styles.secondaryButton} onPress={() => { setProfileOpen(false); setReviewLoginOpen(true); }}>
                  <Text style={styles.secondaryButtonText}>Acceso para Apple Review</Text>
                </Pressable>
              )}
              {cloudSession && (
                <Pressable style={[styles.fullButton, styles.avatarProfileButton]} onPress={() => { setProfileOpen(false); setAvatarOpen(true); }}>
                  <Text style={styles.fullButtonText}>{avatarDisplaySource ? "Administrar mi avatar" : "Crear mi avatar"}</Text>
                </Pressable>
              )}
              {cloudSession && <Pressable style={styles.secondaryButton} onPress={() => Promise.all([loadWardrobe(), loadOutfits(), loadAvatar()])} disabled={wardrobeLoading}><Text style={styles.secondaryButtonText}>{wardrobeLoading ? "Sincronizando…" : "Sincronizar mi cuenta"}</Text></Pressable>}
              <Text style={styles.experimentalNote}>CONEXIÓN PRIVADA · Tu sesión sólo se utiliza cuando analizas fotos o generas imágenes y se protege en este iPhone.</Text>
              {!codexConnected && <Pressable style={[styles.fullButton, styles.experimentalButton, codexConnecting && styles.disabledButton]} onPress={connectCodexExperiment} disabled={codexConnecting}><Text style={styles.fullButtonText}>{codexConnecting ? "Esperando autorización…" : "Continuar con ChatGPT · prueba"}</Text></Pressable>}
              {codexConnected && <Pressable style={[styles.secondaryButton, styles.experimentalButton]} onPress={disconnectCodexExperiment}><Text style={styles.secondaryButtonText}>Cerrar sesión experimental</Text></Pressable>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={reviewLoginOpen} transparent animationType="slide" onRequestClose={() => !reviewSigningIn && setReviewLoginOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Pressable style={styles.closeButton} onPress={() => setReviewLoginOpen(false)} disabled={reviewSigningIn}><Text style={styles.closeText}>×</Text></Pressable>
            <Text style={[styles.eyebrow, styles.centerText]}>APPLE APP REVIEW</Text>
            <Text style={styles.modalTitle}>Acceso de revisión.</Text>
            <Text style={styles.modalIntro}>Cuenta aislada para que el equipo de Apple pruebe las funciones Premium sin utilizar una cuenta personal.</Text>
            <TextInput style={styles.productUrlInput} value={reviewEmail} onChangeText={setReviewEmail} placeholder="Correo de revisión" placeholderTextColor="#9B9386" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!reviewSigningIn} />
            <TextInput style={styles.productUrlInput} value={reviewPassword} onChangeText={setReviewPassword} placeholder="Contraseña" placeholderTextColor="#9B9386" autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!reviewSigningIn} onSubmitEditing={() => signInForAppReview().catch(() => undefined)} />
            <Pressable style={[styles.fullButton, (!reviewEmail.trim() || !reviewPassword || reviewSigningIn) && styles.disabledButton]} onPress={() => signInForAppReview().catch(() => undefined)} disabled={!reviewEmail.trim() || !reviewPassword || reviewSigningIn}>
              {reviewSigningIn ? <ActivityIndicator color={paper} /> : <Text style={styles.fullButtonText}>Entrar a la cuenta de prueba</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>

      <SubscriptionPaywall visible={paywallOpen} onClose={() => setPaywallOpen(false)} cloud={cloudSession} />
      <PrivacyPolicyModal visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      <Modal visible={avatarOpen} transparent animationType="slide" onRequestClose={() => setAvatarOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.avatarSheet}>
            <Pressable style={styles.closeButton} onPress={() => setAvatarOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.avatarSheetContent}>
              <Text style={[styles.eyebrow, styles.centerText]}>IDENTIDAD PRIVADA</Text>
              <Text style={styles.modalTitle}>{avatarDraftUri ? "¿Este avatar sí eres tú?" : avatarDisplaySource ? "Actualiza tu avatar." : "Crea tu avatar."}</Text>
              <Text style={styles.modalIntro}>{avatarDraftUri
                ? "Confirma únicamente si el rostro y las proporciones se parecen a ti. Después se convertirá en la base de todos tus outfits."
                : "Elige una selfie clara y una foto de cuerpo completo. Outfit Club creará una base neutral reutilizable para el probador."}</Text>

              {avatarDraftUri ? (
                <>
                  <View style={styles.avatarDraftFrame}><Image source={{ uri: avatarDraftUri }} resizeMode="contain" style={styles.avatarDraftImage} /></View>
                  <View style={styles.privacyPill}><View style={styles.greenDot} /><Text style={styles.privacyPillText}>SOLO SE GUARDA AL CONFIRMAR</Text></View>
                  <Pressable style={[styles.fullButton, styles.avatarConfirmButton, avatarSaving && styles.disabledButton]} onPress={saveAvatarDraft} disabled={avatarSaving}>
                    <Text style={styles.fullButtonText}>{avatarSaving ? "Guardando en tu nube…" : "Sí, este soy yo · Guardar"}</Text>
                  </Pressable>
                  <Pressable style={styles.secondaryButton} onPress={discardAvatarDraft} disabled={avatarSaving}>
                    <Text style={styles.secondaryButtonText}>No se parece · Cambiar referencias</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  {avatarDisplaySource && (
                    <View style={styles.currentAvatarCard}>
                      <Image source={avatarDisplaySource} resizeMode="contain" style={styles.currentAvatarImage} />
                      <View style={styles.currentAvatarCopy}>
                        <Text style={styles.currentAvatarEyebrow}>AVATAR ACTUAL</Text>
                        <Text style={styles.currentAvatarTitle}>Tus Looks históricos no cambiarán.</Text>
                      </View>
                    </View>
                  )}
                  <View style={styles.avatarReferenceRow}>
                    <Pressable style={styles.avatarReferenceCard} onPress={() => pickAvatarReference("selfie")}>
                      {avatarSelfie
                        ? <Image source={{ uri: avatarSelfie.uri }} resizeMode="cover" style={styles.avatarReferenceImage} />
                        : <View style={styles.avatarReferenceEmpty}><Text style={styles.avatarReferenceNumber}>01</Text><Text style={styles.avatarReferenceTitle}>Selfie frontal</Text><Text style={styles.avatarReferenceHint}>Cara clara, sin filtros</Text></View>}
                      {avatarSelfie && <Text style={styles.avatarReferenceChange}>CAMBIAR SELFIE</Text>}
                    </Pressable>
                    <Pressable style={styles.avatarReferenceCard} onPress={() => pickAvatarReference("body")}>
                      {avatarFullBody
                        ? <Image source={{ uri: avatarFullBody.uri }} resizeMode="cover" style={styles.avatarReferenceImage} />
                        : <View style={styles.avatarReferenceEmpty}><Text style={styles.avatarReferenceNumber}>02</Text><Text style={styles.avatarReferenceTitle}>Cuerpo completo</Text><Text style={styles.avatarReferenceHint}>Cabeza y pies visibles</Text></View>}
                      {avatarFullBody && <Text style={styles.avatarReferenceChange}>CAMBIAR FOTO</Text>}
                    </Pressable>
                  </View>
                  <Pressable style={styles.avatarConsentRow} onPress={() => setAvatarConsent((value) => !value)}>
                    <View style={[styles.avatarConsentBox, avatarConsent && styles.avatarConsentBoxActive]}><Text style={styles.avatarConsentCheck}>{avatarConsent ? "✓" : ""}</Text></View>
                    <Text style={styles.avatarConsentText}>Soy la persona de ambas fotos o tengo su permiso. Entiendo que se enviarán a ChatGPT para crear el avatar; Outfit Club no las guardará en su nube.</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.fullButton, styles.avatarConfirmButton, (!avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating) && styles.disabledButton]}
                    onPress={generateAvatarDraft}
                    disabled={!avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating}
                  >
                    {avatarGenerating ? <ActivityIndicator color={paper} /> : <Text style={styles.fullButtonText}>✦ Crear vista previa</Text>}
                  </Pressable>
                  <Text style={styles.avatarPrivacyCopy}>La vista previa usa calidad media una sola vez. Después cada outfit reutiliza el avatar confirmado.</Text>
                  {avatarDisplaySource && <Pressable onPress={deleteAccountAvatar}><Text style={styles.deleteText}>Eliminar avatar actual</Text></Pressable>}
                </>
              )}
            </ScrollView>
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
                <Text style={styles.detailIntro}>{selectedItem.description || (selectedItem.imagePath ? "Esta es la foto original de la prenda. Prepara su imagen para usarla en tus Looks." : "Esta prenda todavía se está preparando.")}</Text>
                {selectedItem.qaSummary?.summary && <Text style={styles.qaSummary}>{selectedItem.qaSummary.summary}</Text>}
                {selectedItem.isBasic && <Text style={styles.qaSummary}>Básico reconocido · conservamos la foto original sin gastar una generación.</Text>}
                {selectedItem.sourceType === "internet" && selectedItem.sourceUrl && (
                  <Pressable style={styles.secondaryButton} onPress={() => Linking.openURL(selectedItem.sourceUrl!).catch(() => undefined)}>
                    <Text style={styles.secondaryButtonText}>Abrir página del producto ↗</Text>
                  </Pressable>
                )}
                {selectedItem.imagePath && !selectedItem.isBasic && selectedItem.sourceType !== "internet" && (
                  <Pressable style={[styles.fullButton, styles.reconstructAction, reconstructingId === selectedItem.id && styles.disabledButton]} onPress={() => chooseReconstruction(selectedItem)} disabled={reconstructingId === selectedItem.id}>
                    <Text style={styles.fullButtonText}>{reconstructingId === selectedItem.id ? "Creando y verificando…" : selectedItem.status === "approved" ? "Regenerar imagen" : "Crear imagen transparente"}</Text>
                  </Pressable>
                )}
                <Pressable style={styles.fullButton} onPress={() => addToTryOn(selectedItem)}>
                  <Text style={styles.fullButtonText}>{tryOnLayers.some((layer) => layer.item.id === selectedItem.id) ? "✓ En el probador" : "＋ Probar en mi avatar"}</Text>
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
            <ScrollView showsVerticalScrollIndicator={false}>
              {selectedOutfit && <OutfitVisual outfit={selectedOutfit} session={cloudSession} />}
              {selectedOutfit && (
                <View style={styles.detailCopy}>
                  <Text style={styles.eyebrow}>{selectedOutfit.occasion.toUpperCase()}</Text>
                  <Text style={styles.detailTitle}>{selectedOutfit.name}</Text>
                  <Text style={styles.detailIntro}>{selectedOutfit.note}</Text>
                  <View style={styles.outfitPieceList}>
                    {selectedOutfit.pieces.map((piece) => <Text key={String(piece.id)} style={styles.outfitPieceName}>• {piece.name}</Text>)}
                  </View>
                  {!selectedOutfit.renderPath && (
                    <Pressable
                      style={[styles.fullButton, styles.reconstructAction, outfitGenerating && styles.disabledButton]}
                      onPress={() => createOutfitPhotograph(selectedOutfit)}
                      disabled={outfitGenerating}
                    >
                      <Text style={styles.fullButtonText}>{outfitGenerating && outfitGenerationProgress
                        ? `Vistiéndote ${outfitGenerationProgress.current}/${outfitGenerationProgress.total}…`
                        : "✦ Crear mi foto con este Look"}</Text>
                    </Pressable>
                  )}
                  <Pressable style={styles.fullButton} onPress={() => trySavedOutfit(selectedOutfit)}>
                    <Text style={styles.fullButtonText}>Editar este outfit en el probador</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
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
  notice: { position: "absolute", zIndex: 100, top: 10, left: 14, right: 14, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16, backgroundColor: ink, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  noticeSuccess: { backgroundColor: "#405641" },
  noticeError: { backgroundColor: "#7A382D" },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: paper, fontSize: 12, fontWeight: "800" },
  noticeMessage: { color: "rgba(243,239,229,.82)", fontSize: 9, lineHeight: 13, marginTop: 3 },
  noticeClose: { color: paper, fontSize: 22, fontWeight: "300" },
  topbar: { height: 58, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandMark: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: ink },
  brandLetter: { color: paper, fontSize: 7, fontWeight: "900", letterSpacing: .2 },
  brandName: { color: ink, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  cloudBadge: { marginLeft: "auto", marginRight: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  cloudBadgeText: { color: "#60705B", fontSize: 7, fontWeight: "700", letterSpacing: 0.8 },
  cloudBadgePending: { color: rust },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#71826A" },
  rustDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: rust },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: ink },
  avatarText: { color: ink, fontSize: 9, fontWeight: "700" },
  avatarThumb: { width: 28, height: 28, borderRadius: 14 },
  screenContent: { paddingHorizontal: 16, paddingTop: 26, paddingBottom: 110 },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 18 },
  eyebrow: { color: rust, fontSize: 8, fontWeight: "700", letterSpacing: 1.45, marginBottom: 7 },
  pageTitle: { color: ink, fontSize: 38, lineHeight: 40, letterSpacing: -1.5, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  count: { color: muted, fontSize: 16 },
  importButton: { backgroundColor: ink, paddingHorizontal: 13, paddingVertical: 11 },
  importButtonText: { color: paper, fontSize: 9, fontWeight: "700" },
  batchBanner: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 15, padding: 11, borderWidth: 1, borderColor: "#B7C0B2", backgroundColor: "#EDF0E8" },
  batchBannerError: { borderColor: "#D5B8AA", backgroundColor: "#F5E9E2" },
  batchBannerText: { flex: 1, gap: 2 },
  batchTitle: { color: ink, fontSize: 10, fontWeight: "700" },
  batchMeta: { color: muted, fontSize: 8 },
  importProgressTrack: { height: 3, marginTop: 5, overflow: "hidden", borderRadius: 2, backgroundColor: "rgba(113,130,106,.2)" },
  importProgressFill: { height: 3, borderRadius: 2, backgroundColor: "#71826A" },
  reviewText: { color: ink, fontSize: 8, fontWeight: "700", textDecorationLine: "underline" },
  filters: { gap: 7, paddingBottom: 18 },
  filter: { borderWidth: 1, borderColor: line, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 20 },
  filterActive: { backgroundColor: ink, borderColor: ink },
  filterText: { color: muted, fontSize: 9 },
  filterTextActive: { color: paper },
  emptyCollection: { alignItems: "center", marginTop: 34, paddingHorizontal: 26, paddingVertical: 34, borderWidth: 1, borderStyle: "dashed", borderColor: line, backgroundColor: "#F8F5ED" },
  emptyCollectionTitle: { color: ink, fontSize: 17, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  emptyCollectionCopy: { color: muted, maxWidth: 250, marginTop: 8, textAlign: "center", fontSize: 9, lineHeight: 14 },
  cardRow: { gap: 9 },
  garmentCard: { flex: 1, position: "relative", marginBottom: 13, backgroundColor: paper, borderWidth: StyleSheet.hairlineWidth, borderColor: "transparent" },
  looksIntro: { color: muted, fontSize: 9, lineHeight: 14, marginTop: -7, marginBottom: 18, maxWidth: 310 },
  outfitCollage: { position: "relative", width: "100%", aspectRatio: 0.72, overflow: "hidden", backgroundColor: "#E9E2D5" },
  outfitVisualLayer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  outfitCollageCell: { position: "absolute", width: "50%", height: "50%", alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(216,209,196,.72)" },
  outfitCollageImage: { width: "92%", height: "92%" },
  outfitCollageFallback: { color: rust, fontSize: 17 },
  outfitRenderImage: { width: "100%", height: "100%" },
  outfitReadyBadge: { position: "absolute", left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(33,31,27,.78)" },
  outfitReadyBadgeText: { color: paper, fontSize: 6, fontWeight: "900", letterSpacing: 0.9 },
  outfitPendingBadge: { position: "absolute", left: 0, right: 0, bottom: 9, alignItems: "center" },
  outfitPendingBadgeText: { color: paper, fontSize: 6, fontWeight: "900", letterSpacing: 0.8, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: "rgba(33,31,27,.78)" },
  spriteFrame: { width: "100%", overflow: "hidden", backgroundColor: paper },
  cloudGarmentImage: { width: "100%", height: "100%" },
  evidenceBadge: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: "rgba(33,31,27,.78)" },
  evidenceBadgeText: { color: paper, fontSize: 6, fontWeight: "800", letterSpacing: 0.7 },
  internetBadge: { position: "absolute", right: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 9, backgroundColor: rust },
  internetBadgeText: { color: "white", fontSize: 6, fontWeight: "900", letterSpacing: 0.8 },
  cardCopy: { padding: 10, backgroundColor: paper },
  cardTitle: { color: ink, fontSize: 10, fontWeight: "700" },
  cardMeta: { color: muted, fontSize: 8, marginTop: 3 },
  selectedDot: { position: "absolute", right: 7, top: 7, width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: ink },
  selectedDotText: { color: paper, fontSize: 9 },
  disabledText: { opacity: 0.4 },
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
  tryOnHeadingRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14 },
  tryOnHeadingCopy: { flex: 1 },
  tryOnTitle: { color: ink, fontSize: 39, lineHeight: 41, letterSpacing: -1.5, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  tryOnIntro: { color: muted, fontSize: 10, lineHeight: 15, marginTop: 7, maxWidth: 275 },
  clearTryOnButton: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: line, borderRadius: 18, marginBottom: 2 },
  clearTryOnText: { color: muted, fontSize: 8, fontWeight: "700" },
  webTryOnBanner: { flexDirection: "row", alignItems: "center", gap: 11, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: "#D5B8AA", borderRadius: 14, backgroundColor: "#F5E9E2" },
  webTryOnIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: rust },
  webTryOnIconText: { color: "white", fontSize: 16, fontWeight: "700" },
  webTryOnCopy: { flex: 1 },
  webTryOnEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: 0.8 },
  webTryOnTitle: { color: ink, fontSize: 11, fontWeight: "800", marginTop: 3 },
  webTryOnArrow: { color: rust, fontSize: 24, fontWeight: "300" },
  tryOnRail: { gap: 8, paddingVertical: 4, paddingRight: 12, marginBottom: 14 },
  tryOnRailDisabled: { opacity: 0.48 },
  tryOnRailItem: { width: 78, overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 8, backgroundColor: "#F8F5ED" },
  tryOnRailItemActive: { borderWidth: 2, borderColor: rust },
  tryOnRailLabel: { color: ink, fontSize: 7, fontWeight: "700", paddingHorizontal: 6, paddingBottom: 7, textAlign: "center" },
  dragAffordance: { position: "absolute", right: 4, top: 4, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(33,31,27,.82)" },
  dragAffordanceText: { color: paper, fontSize: 9, fontWeight: "800" },
  tryOnRailEmpty: { width: 260, minHeight: 92, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderWidth: 1, borderStyle: "dashed", borderColor: line },
  tryOnRailEmptyText: { color: muted, fontSize: 9, lineHeight: 14, textAlign: "center" },
  tryOnCanvas: { position: "relative", width: "100%", height: 492, overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 20, backgroundColor: "#E9E2D5" },
  tryOnCanvasHalo: { position: "absolute", width: 260, height: 260, borderRadius: 130, left: "50%", top: 84, marginLeft: -130, backgroundColor: "rgba(255,255,255,.48)" },
  tryOnAvatarImage: { position: "absolute", left: 0, right: 0, top: 6, bottom: 4, width: "100%", height: "98%" },
  avatarPlaceholder: { position: "absolute", left: 34, right: 34, top: 84, bottom: 84, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: "#B8B0A2", borderRadius: 140, backgroundColor: "rgba(248,245,237,.72)" },
  avatarPlaceholderIcon: { color: rust, fontSize: 38, fontWeight: "200" },
  avatarPlaceholderTitle: { color: ink, fontSize: 10, fontWeight: "900", letterSpacing: 1.2, marginTop: 12 },
  avatarPlaceholderCopy: { color: muted, fontSize: 8, marginTop: 6 },
  bodyDropZone: { position: "absolute", zIndex: 30, alignItems: "center", justifyContent: "center", borderWidth: 2, borderStyle: "dashed", borderColor: "rgba(163,79,49,.55)", borderRadius: 24, backgroundColor: "rgba(163,79,49,.10)" },
  bodyDropZoneReady: { borderColor: "#71826A", borderStyle: "solid", backgroundColor: "rgba(113,130,106,.22)" },
  bodyDropHead: { left: "31%", top: "1%", width: "38%", height: "19%", borderRadius: 60 },
  bodyDropTorso: { left: "15%", top: "18%", width: "70%", height: "38%" },
  bodyDropLegs: { left: "20%", top: "45%", width: "60%", height: "38%" },
  bodyDropFeet: { left: "20%", top: "78%", width: "60%", height: "20%" },
  bodyDropZoneText: { color: rust, fontSize: 7, fontWeight: "900", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(243,239,229,.88)" },
  bodyDropZoneTextReady: { color: "#52604D", backgroundColor: "rgba(247,249,244,.92)" },
  tryOnRenderingOverlay: { position: "absolute", zIndex: 40, left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(233,226,213,.72)" },
  tryOnRenderingCard: { width: 230, alignItems: "center", paddingHorizontal: 24, paddingVertical: 23, borderRadius: 20, borderWidth: 1, borderColor: "rgba(163,79,49,.22)", backgroundColor: "rgba(248,245,237,.96)" },
  tryOnRenderingTitle: { color: ink, fontSize: 14, fontWeight: "800", marginTop: 13 },
  tryOnRenderingCopy: { color: muted, fontSize: 8, lineHeight: 13, textAlign: "center", marginTop: 6 },
  tryOnLayer: { position: "absolute", left: 0, top: 0, borderWidth: 1, borderColor: "transparent", borderRadius: 10 },
  tryOnLayerSelected: { borderColor: "rgba(163,79,49,.75)", borderStyle: "dashed", backgroundColor: "rgba(255,255,255,.08)" },
  tryOnLayerImage: { width: "100%", height: "100%" },
  tryOnHandle: { position: "absolute", right: -11, top: -11, width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: rust, borderWidth: 2, borderColor: paper },
  tryOnHandleText: { color: "white", fontSize: 10, fontWeight: "800" },
  tryOnHint: { position: "absolute", left: 0, right: 0, top: 202, alignItems: "center" },
  tryOnHintIcon: { color: rust, fontSize: 20, fontWeight: "300" },
  tryOnHintText: { color: rust, fontSize: 7, fontWeight: "800", letterSpacing: 1.2, marginTop: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: "rgba(243,239,229,.86)" },
  tryOnPendingBadge: { position: "absolute", left: 0, right: 0, bottom: 18, alignItems: "center" },
  tryOnPendingBadgeText: { color: paper, fontSize: 7, fontWeight: "800", letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 15, backgroundColor: "rgba(25,24,21,.82)" },
  tryOnControls: { minHeight: 59, flexDirection: "row", alignItems: "center", gap: 7, marginTop: 10, paddingHorizontal: 11, paddingVertical: 9, borderWidth: 1, borderColor: line, borderRadius: 14, backgroundColor: "#F8F5ED" },
  tryOnControlCopy: { flex: 1, paddingRight: 4 },
  tryOnControlEyebrow: { color: rust, fontSize: 6, fontWeight: "800", letterSpacing: 0.8 },
  tryOnControlName: { color: ink, fontSize: 10, fontWeight: "700", marginTop: 3 },
  tryOnControlButton: { width: 35, height: 35, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: line, backgroundColor: paper },
  tryOnControlButtonText: { color: ink, fontSize: 16, fontWeight: "600" },
  tryOnDeleteButton: { borderColor: "#D2A596", backgroundColor: "#F6EAE4" },
  tryOnDeleteButtonText: { color: rust, fontSize: 21, lineHeight: 23, fontWeight: "300" },
  tryOnSelectionPanel: { marginTop: 10, padding: 11, borderWidth: 1, borderColor: line, borderRadius: 14, backgroundColor: "#F8F5ED" },
  tryOnSelectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  tryOnQualityBadge: { color: rust, fontSize: 6, fontWeight: "800", letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 10, backgroundColor: "#F2E1D9" },
  tryOnSelectionChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  tryOnSelectionChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 10, paddingRight: 7, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: "#C8BFB1", backgroundColor: paper },
  tryOnSelectionChipText: { color: ink, maxWidth: 150, fontSize: 8, fontWeight: "700" },
  tryOnSelectionChipRemove: { color: rust, fontSize: 15, lineHeight: 15 },
  generateTryOnOutfitButton: { alignItems: "center", marginTop: 10, paddingVertical: 13, borderRadius: 20, backgroundColor: rust },
  generateTryOnOutfitButtonText: { color: "#FFF9EF", fontSize: 9, fontWeight: "800", letterSpacing: 0.2 },
  improveTryOnButton: { alignItems: "center", marginTop: 10, paddingVertical: 11, borderRadius: 18, backgroundColor: ink },
  improveTryOnButtonText: { color: paper, fontSize: 8, fontWeight: "800", letterSpacing: 0.25 },
  tryOnFootnote: { color: muted, fontSize: 7, lineHeight: 11, textAlign: "center", marginTop: 10 },
  wardrobeDragGhost: { position: "absolute", zIndex: 200, width: 86, height: 86, padding: 5, borderRadius: 18, borderWidth: 2, borderColor: rust, backgroundColor: "rgba(248,245,237,.95)", shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  wardrobeDragGhostReady: { borderColor: "#71826A", transform: [{ scale: 1.08 }] },
  wardrobeDragGhostImage: { width: "100%", height: "100%" },
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
  lookHoldHint: { color: rust, fontSize: 5.5, fontWeight: "900", letterSpacing: 0.55, marginTop: 7 },
  outfitPieceList: { marginTop: 12, marginBottom: 14, padding: 12, gap: 5, borderWidth: 1, borderColor: line, borderRadius: 12, backgroundColor: "#F8F5ED" },
  outfitPieceName: { color: ink, fontSize: 9, lineHeight: 14 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.45)" },
  modalSheet: { maxHeight: "92%", paddingHorizontal: 20, paddingTop: 32, paddingBottom: 30, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  importModalContent: { paddingBottom: 4 },
  profileSheet: { maxHeight: "92%", paddingHorizontal: 22, paddingTop: 38, paddingBottom: 28, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  avatarSheet: { maxHeight: "94%", overflow: "hidden", backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  avatarSheetContent: { paddingHorizontal: 20, paddingTop: 38, paddingBottom: 36 },
  closeButton: { position: "absolute", zIndex: 5, right: 14, top: 12, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.65)" },
  closeText: { color: ink, fontSize: 25, fontWeight: "300" },
  scanOrb: { width: 58, height: 58, marginBottom: 20, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 29, borderWidth: 1, borderColor: line, backgroundColor: "#F8F5ED" },
  scanOrbText: { color: rust, fontSize: 20 },
  centerText: { textAlign: "center" },
  modalTitle: { color: ink, fontSize: 34, lineHeight: 37, textAlign: "center", letterSpacing: -1.2, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  modalIntro: { color: muted, maxWidth: 330, alignSelf: "center", textAlign: "center", fontSize: 10, lineHeight: 16, marginTop: 12, marginBottom: 13 },
  privacyPill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: "#BCC5B8", backgroundColor: "#EDF0E8" },
  privacyPillText: { color: "#60705B", fontSize: 7, fontWeight: "800", letterSpacing: 0.7 },
  webImportChoice: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, padding: 12, borderWidth: 1, borderColor: "#D5B8AA", borderRadius: 13, backgroundColor: "#F5E9E2" },
  webImportChoiceIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: rust },
  webImportChoiceIconText: { color: "white", fontSize: 14, fontWeight: "800" },
  webImportChoiceCopy: { flex: 1 },
  webImportChoiceTitle: { color: ink, fontSize: 10, fontWeight: "800" },
  webImportChoiceHint: { color: muted, fontSize: 7, lineHeight: 11, marginTop: 3 },
  webImportChoiceArrow: { color: rust, fontSize: 22, fontWeight: "300" },
  importDivider: { color: muted, fontSize: 6, fontWeight: "900", letterSpacing: 1, textAlign: "center", marginTop: 16, marginBottom: -4 },
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
  productUrlInput: { minHeight: 52, marginTop: 6, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: "#B8B0A2", borderRadius: 12, backgroundColor: "#F8F5ED", color: ink, fontSize: 10 },
  pasteLinkButton: { alignSelf: "center", paddingHorizontal: 12, paddingVertical: 10 },
  pasteLinkButtonText: { color: rust, fontSize: 8, fontWeight: "800" },
  productPlacementLabel: { color: muted, fontSize: 6, fontWeight: "900", letterSpacing: 1, marginTop: 8, marginBottom: 7 },
  productPlacementRow: { gap: 6, paddingRight: 12 },
  productPlacementChip: { paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: line, borderRadius: 16, backgroundColor: "#F8F5ED" },
  productPlacementChipActive: { borderColor: rust, backgroundColor: rust },
  productPlacementChipText: { color: muted, fontSize: 7, fontWeight: "700" },
  productPlacementChipTextActive: { color: "white" },
  importProductButton: { marginTop: 18, backgroundColor: rust },
  productImportPrivacy: { color: muted, fontSize: 7, lineHeight: 12, textAlign: "center", marginTop: 11 },
  fullButton: { width: "100%", alignItems: "center", backgroundColor: ink, paddingVertical: 15 },
  secondaryButton: { width: "100%", alignItems: "center", marginTop: 14, borderWidth: 1, borderColor: ink, paddingVertical: 13 },
  secondaryButtonText: { color: ink, fontSize: 9, fontWeight: "800" },
  reconstructAction: { marginBottom: 8, backgroundColor: rust },
  disabledButton: { opacity: 0.6 },
  fullButtonText: { color: paper, fontSize: 10, fontWeight: "800" },
  deleteText: { color: "#8B4733", textAlign: "center", fontSize: 9, paddingTop: 15 },
  profileAvatar: { width: 64, height: 64, marginBottom: 18, alignSelf: "center", alignItems: "center", justifyContent: "center", borderRadius: 32, backgroundColor: ink },
  profileAvatarImage: { width: 64, height: 64, borderRadius: 32 },
  profileAvatarText: { color: paper, fontSize: 16, fontWeight: "800" },
  avatarProfileButton: { marginTop: 18, backgroundColor: rust },
  architectureCard: { marginTop: 10, borderTopWidth: 1, borderTopColor: line },
  architectureRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: line },
  architectureLabel: { color: muted, fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  architectureValue: { color: "#60705B", fontSize: 10, fontWeight: "700" },
  architecturePending: { color: rust, fontSize: 10, fontWeight: "700" },
  profileFootnote: { color: muted, textAlign: "center", fontSize: 9, lineHeight: 14, marginTop: 18 },
  premiumCard: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 18, padding: 13, borderWidth: 1, borderColor: "#D5B8AA", borderRadius: 15, backgroundColor: "#F5E9E2" },
  premiumCardIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: ink },
  premiumCardIconText: { color: paper, fontSize: 8, fontWeight: "900", letterSpacing: .5 },
  premiumCardCopy: { flex: 1 },
  premiumCardEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: .9 },
  premiumCardTitle: { color: ink, fontSize: 10, fontWeight: "800", marginTop: 4 },
  premiumCardArrow: { color: rust, fontSize: 25, fontWeight: "300" },
  experimentalNote: { color: rust, textAlign: "center", fontSize: 7, lineHeight: 12, fontWeight: "800", letterSpacing: 0.45, marginTop: 18, marginBottom: 10 },
  experimentalButton: { marginTop: 0 },
  avatarDraftFrame: { width: "100%", aspectRatio: 0.72, marginTop: 9, marginBottom: 14, overflow: "hidden", borderRadius: 20, borderWidth: 1, borderColor: line, backgroundColor: "#E9E2D5" },
  avatarDraftImage: { width: "100%", height: "100%" },
  avatarConfirmButton: { marginTop: 16, backgroundColor: rust },
  currentAvatarCard: { flexDirection: "row", alignItems: "center", gap: 14, marginTop: 6, marginBottom: 18, padding: 10, borderWidth: 1, borderColor: line, borderRadius: 15, backgroundColor: "#F8F5ED" },
  currentAvatarImage: { width: 70, height: 94, borderRadius: 10, backgroundColor: "#E9E2D5" },
  currentAvatarCopy: { flex: 1 },
  currentAvatarEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: 1 },
  currentAvatarTitle: { color: ink, fontSize: 11, lineHeight: 16, fontWeight: "700", marginTop: 5 },
  avatarReferenceRow: { flexDirection: "row", gap: 9, marginTop: 8 },
  avatarReferenceCard: { flex: 1, minHeight: 190, overflow: "hidden", borderWidth: 1, borderStyle: "dashed", borderColor: "#B8B0A2", borderRadius: 15, backgroundColor: "#F8F5ED" },
  avatarReferenceEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  avatarReferenceNumber: { color: rust, fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  avatarReferenceTitle: { color: ink, fontSize: 11, fontWeight: "800", textAlign: "center", marginTop: 9 },
  avatarReferenceHint: { color: muted, fontSize: 7, lineHeight: 11, textAlign: "center", marginTop: 5 },
  avatarReferenceImage: { width: "100%", height: 161 },
  avatarReferenceChange: { color: ink, fontSize: 6, fontWeight: "900", letterSpacing: 0.7, textAlign: "center", paddingVertical: 10 },
  avatarConsentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: "#F8F5ED" },
  avatarConsentBox: { width: 21, height: 21, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#A49B8D", borderRadius: 5, backgroundColor: paper },
  avatarConsentBoxActive: { borderColor: "#71826A", backgroundColor: "#71826A" },
  avatarConsentCheck: { color: "white", fontSize: 12, fontWeight: "900" },
  avatarConsentText: { flex: 1, color: muted, fontSize: 8, lineHeight: 13 },
  avatarPrivacyCopy: { color: muted, fontSize: 7, lineHeight: 11, textAlign: "center", marginTop: 10 },
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

async function uploadError(stage: string, response: Response) {
  let serverCode = "unknown";
  try {
    const payload = await response.json() as { error?: string };
    if (payload.error) serverCode = payload.error;
  } catch {
    // The status and stage still identify the failed request.
  }
  return new Error(`${stage}_${response.status}_${serverCode}`);
}

function uploadResultError(stage: string, status: number, body: string) {
  let serverCode = "unknown";
  try {
    const payload = JSON.parse(body) as { error?: string };
    if (payload.error) serverCode = payload.error;
  } catch {
    // The status and stage still identify the failed request.
  }
  return new Error(`${stage}_${status}_${serverCode}`);
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

async function uploadExperimentalGarmentImage(session: CloudSession, garmentId: string, base64: string) {
  if (!FileSystem.cacheDirectory) throw new Error("image_cache_unavailable");
  const localPath = `${FileSystem.cacheDirectory}vesta-generated-${garmentId}.png`;
  await FileSystem.writeAsStringAsync(localPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const response = await FileSystem.uploadAsync(
      `${session.apiUrl}/api/v1/garments/${garmentId}/experimental-image`,
      localPath,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: {
          "Content-Type": "image/png",
          "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
          "x-vesta-device-token": session.deviceToken,
        },
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw uploadResultError("generated_image", response.status, response.body);
    }
  } finally {
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
  }
}

async function uploadOutfitRender(session: CloudSession, outfitId: string, base64: string, usageReservationId: string | null = null) {
  if (!FileSystem.cacheDirectory) throw new Error("image_cache_unavailable");
  const localPath = `${FileSystem.cacheDirectory}vesta-outfit-${outfitId}.png`;
  await FileSystem.writeAsStringAsync(localPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const response = await FileSystem.uploadAsync(
      `${session.apiUrl}/api/v1/outfits/${outfitId}/render`,
      localPath,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: {
          "Content-Type": "image/png",
          "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
          "x-vesta-device-token": session.deviceToken,
          ...(usageReservationId ? { "x-vesta-usage-reservation": usageReservationId } : {}),
        },
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw uploadResultError("outfit_render", response.status, response.body);
    }
    const payload = JSON.parse(response.body) as { renderPath?: string };
    if (!payload.renderPath) throw new Error("outfit_render_path_missing");
    return payload.renderPath;
  } finally {
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
  }
}

async function uploadAccountAvatar(session: CloudSession, base64: string) {
  if (!FileSystem.cacheDirectory) throw new Error("image_cache_unavailable");
  const localPath = `${FileSystem.cacheDirectory}vesta-avatar-upload-${Date.now()}.png`;
  await FileSystem.writeAsStringAsync(localPath, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const response = await FileSystem.uploadAsync(
      `${session.apiUrl}/api/v1/avatar`,
      localPath,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: {
          "Content-Type": "image/png",
          "OAI-Sites-Authorization": `Bearer ${session.dispatchToken}`,
          "x-vesta-device-token": session.deviceToken,
        },
      },
    );
    if (response.status < 200 || response.status >= 300) {
      throw uploadResultError("avatar", response.status, response.body);
    }
    const payload = JSON.parse(response.body) as { avatar?: CloudAvatar };
    if (!payload.avatar) throw new Error("avatar_payload_missing");
    return payload.avatar;
  } finally {
    await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
  }
}

function accountCachePrefix(session: CloudSession) {
  return session.deviceId.replace(/[^a-z0-9_-]/giu, "_");
}

function avatarCachePath(session: CloudSession) {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${accountCachePrefix(session)}-avatar.png` : null;
}

function outfitCachePath(session: CloudSession, outfitId: string) {
  if (!FileSystem.documentDirectory) return null;
  const safeOutfitId = outfitId.replace(/[^a-z0-9_-]/giu, "_");
  return `${FileSystem.documentDirectory}vesta-${accountCachePrefix(session)}-look-${safeOutfitId}.png`;
}

function outfitIndexCachePath(session: CloudSession) {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}vesta-${accountCachePrefix(session)}-looks.json` : null;
}

async function recordAvatarGenerationAudit(audit: AvatarGenerationAudit) {
  if (!FileSystem.documentDirectory) return;
  const auditPath = `${FileSystem.documentDirectory}vesta-avatar-generation-audit.json`;
  try {
    const info = await FileSystem.getInfoAsync(auditPath).catch(() => null);
    let history: AvatarGenerationAudit[] = [];
    if (info?.exists) {
      const parsed = JSON.parse(await FileSystem.readAsStringAsync(auditPath)) as AvatarGenerationAudit[];
      if (Array.isArray(parsed)) history = parsed;
    }
    history.push(audit);
    await FileSystem.writeAsStringAsync(auditPath, JSON.stringify(history.slice(-20), null, 2));
    console.info("[Vesta avatar generation audit]", JSON.stringify(audit));
  } catch {
    // Private diagnostics must never interrupt the fitting experience.
  }
}

function categoryForUi(category: string): Exclude<Category, "all"> {
  if (category === "tops" || category === "layers" || category === "bottoms" || category === "accessories") return category;
  if (category === "footwear") return "accessories";
  if (category === "one_piece") return "layers";
  return "accessories";
}

function statusLabel(status?: string) {
  if (status === "approved") return "verificada";
  if (status === "qa") return "revisar imagen";
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
