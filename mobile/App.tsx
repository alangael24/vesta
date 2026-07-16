import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as Device from "expo-device";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { memo, useEffect, useMemo, useRef, useState } from "react";
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
import { SubscriptionPaywall, SubscriptionStatus } from "./SubscriptionPaywall";
import { PrivacyPolicyModal } from "./PrivacyPolicy";

type ViewName = "home" | "profile" | "closet" | "builder" | "looks" | "calendar" | "wishlist";
type Category = "all" | "tops" | "layers" | "bottoms" | "footwear" | "accessories" | "one_piece";
type ClosetFilter = "all" | "clothing" | "footwear" | "accessories";
type ItemId = number | string;

type WardrobeItem = {
  id: ItemId;
  name: string;
  category: Exclude<Category, "all">;
  type: string;
  color: string;
  secondaryColor?: string | null;
  tags?: string[];
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
type PaywallReason = "wardrobe" | "try_on" | "looks";
type ProductPlacementHint = "auto" | "head" | "top" | "outer" | "legs" | "one_piece" | "feet";
type AvatarStatusPayload = {
  avatar?: CloudAvatar;
  generation?: { requestId: string; status: string; error?: string | null } | null;
};

type BodyRegion = "head" | "torso" | "legs" | "feet";
type FittingSlot = "head" | "top" | "outer" | "legs" | "one_piece" | "feet" | "accessory";
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
  secondaryColor?: string | null;
  tags?: string[];
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

type CalendarEntry = {
  id: string;
  outfitId: string;
  scheduledDate: string;
  note?: string | null;
  createdAt?: string | null;
};

type ImportStage = "idle" | "waiting" | "staging" | "uploading" | "analyzing" | "complete" | "error";
type AppNotice = { id: number; tone: "success" | "error" | "info"; title: string; message?: string };
type GarmentEditDraft = {
  name: string;
  category: Exclude<Category, "all">;
  color: string;
  secondaryColor: string;
  tagsText: string;
};

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

async function clearPrivateLocalData() {
  for (const directory of [FileSystem.documentDirectory, FileSystem.cacheDirectory]) {
    if (!directory) continue;
    const entries = await FileSystem.readDirectoryAsync(directory).catch(() => []);
    await Promise.all(entries
      .filter((name) => name.startsWith("vesta-"))
      .map((name) => FileSystem.deleteAsync(`${directory}${name}`, { idempotent: true }).catch(() => undefined)));
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

const filters: { id: ClosetFilter; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "clothing", label: "Ropa" },
  { id: "footwear", label: "Calzado" },
  { id: "accessories", label: "Accesorios" },
];

const garmentCategoryOptions: Array<{ id: Exclude<Category, "all">; label: string }> = [
  { id: "tops", label: "Tops y blusas" },
  { id: "layers", label: "Abrigos y capas" },
  { id: "bottoms", label: "Faldas y pantalones" },
  { id: "one_piece", label: "Vestidos y enterizos" },
  { id: "footwear", label: "Calzado" },
  { id: "accessories", label: "Bolsos y accesorios" },
];

const productPlacements: Array<{ id: ProductPlacementHint; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "head", label: "Cabeza" },
  { id: "top", label: "Arriba" },
  { id: "outer", label: "Abrigo" },
  { id: "legs", label: "Falda / pantalón" },
  { id: "one_piece", label: "Vestido" },
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
  localPieceImages,
}: {
  outfit: Outfit;
  session: CloudSession | null;
  showPieces?: boolean;
  localPieceImages?: Map<string, string>;
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
      {(showPieces || !renderSource) && <Animated.View
        pointerEvents="none"
        style={[styles.outfitVisualLayer, renderSource ? { opacity: revealProgress } : { opacity: 1 }]}
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
            {localPieceImages?.get(String(piece.id))
              ? <Image source={{ uri: localPieceImages.get(String(piece.id))! }} resizeMode="contain" style={styles.outfitCollageImage} />
              : piece.imagePath && session
                ? <Image source={authorizedImageSource(session, piece.imagePath)} resizeMode="contain" style={styles.outfitCollageImage} />
              : <Text style={styles.outfitCollageFallback}>✦</Text>}
          </Animated.View>
        ))}
        <View style={styles.outfitPendingBadge}>
          <Text style={styles.outfitPendingBadgeText}>{renderSource ? "PRENDAS DEL LOOK" : "FOTO PENDIENTE"}</Text>
        </View>
      </Animated.View>}
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

const LookCard = memo(function LookCard({
  outfit,
  session,
  onOpen,
  onPeek,
  onPeekEnd,
  showPieces,
  localPieceImages,
}: {
  outfit: Outfit;
  session: CloudSession | null;
  onOpen: () => void;
  onPeek: () => void;
  onPeekEnd: () => void;
  showPieces: boolean;
  localPieceImages: Map<string, string>;
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
      <OutfitVisual outfit={outfit} session={session} showPieces={showPieces} localPieceImages={localPieceImages} />
      <View style={styles.lookCopy}>
        <Text style={styles.cardTitle}>{outfit.name}</Text>
        <Text style={styles.cardMeta}>{outfit.occasion} · {outfit.pieces.length} prendas · {outfit.renderPath ? "foto lista" : "foto pendiente"}</Text>
        <Text style={styles.lookHoldHint}>MANTÉN PRESIONADO PARA VER LAS PRENDAS</Text>
      </View>
    </Pressable>
  );
}, (previous, next) => previous.outfit === next.outfit
  && previous.session === next.session
  && previous.showPieces === next.showPieces
  && previous.localPieceImages === next.localPieceImages);

function fittingSlotFor(item: WardrobeItem): FittingSlot {
  const descriptor = `${item.type} ${item.name} ${item.description || ""}`.toLowerCase();
  if (item.category === "footwear") return "feet";
  if (/(gorra|cachucha|sombrero|beanie|bucket|\bcap\b|\bhat\b)/u.test(descriptor)) return "head";
  if (/(zapato|tenis|shoe|sneaker|bota|calzado)/u.test(descriptor)) return "feet";
  if (item.category === "bottoms") return "legs";
  if (item.category === "layers") return "outer";
  if (item.category === "one_piece") return "one_piece";
  if (item.category === "tops") return "top";
  return "accessory";
}

function fittingSlotsConflict(incoming: FittingSlot, existing: FittingSlot) {
  if (incoming === "accessory") return false;
  if (incoming === "one_piece") return existing === "one_piece" || existing === "top" || existing === "legs";
  if (existing === "one_piece" && (incoming === "top" || incoming === "legs")) return true;
  return incoming === existing;
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
  if (slot === "one_piece") return "upper_body" as const;
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

const calendarMonthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const calendarWeekdays = ["L", "M", "M", "J", "V", "S", "D"];

function calendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calendarDaysForMonth(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const mondayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    return day >= 1 && day <= dayCount ? new Date(year, monthIndex, day) : null;
  });
}

function calendarDateLabel(value: string) {
  const date = calendarDateFromKey(value);
  return `${date.getDate()} de ${calendarMonthNames[date.getMonth()].toLowerCase()}`;
}

function calendarQuickDates() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    const weekday = date.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "");
    return {
      date: calendarDateKey(date),
      label: offset === 0 ? "Hoy" : offset === 1 ? "Mañana" : weekday.charAt(0).toUpperCase() + weekday.slice(1),
      day: String(date.getDate()),
    };
  });
}

function CalendarMonthGrid({
  month,
  selectedDate,
  counts,
  onChangeMonth,
  onSelectDate,
}: {
  month: Date;
  selectedDate: string;
  counts: Map<string, number>;
  onChangeMonth: (offset: number) => void;
  onSelectDate: (date: string) => void;
}) {
  const today = calendarDateKey(new Date());
  const days = calendarDaysForMonth(month);
  return (
    <View style={styles.calendarPanel}>
      <View style={styles.calendarMonthHeader}>
        <Pressable style={styles.calendarArrow} onPress={() => onChangeMonth(-1)} accessibilityLabel="Mes anterior"><Text style={styles.calendarArrowText}>‹</Text></Pressable>
        <Text style={styles.calendarMonthTitle}>{calendarMonthNames[month.getMonth()]} {month.getFullYear()}</Text>
        <Pressable style={styles.calendarArrow} onPress={() => onChangeMonth(1)} accessibilityLabel="Mes siguiente"><Text style={styles.calendarArrowText}>›</Text></Pressable>
      </View>
      <View style={styles.calendarWeekRow}>
        {calendarWeekdays.map((weekday, index) => <Text key={`${weekday}-${index}`} style={styles.calendarWeekday}>{weekday}</Text>)}
      </View>
      <View style={styles.calendarDaysGrid}>
        {days.map((date, index) => {
          if (!date) return <View key={`empty-${index}`} style={styles.calendarDayCell} />;
          const key = calendarDateKey(date);
          const count = counts.get(key) || 0;
          const selected = key === selectedDate;
          return (
            <Pressable key={key} style={[styles.calendarDayCell, selected && styles.calendarDayCellSelected]} onPress={() => onSelectDate(key)} accessibilityLabel={`${date.getDate()} de ${calendarMonthNames[date.getMonth()]}`}>
              <Text style={[styles.calendarDayText, key === today && styles.calendarDayToday, selected && styles.calendarDayTextSelected]}>{date.getDate()}</Text>
              {count > 0 && <View style={[styles.calendarDot, selected && styles.calendarDotSelected]}><Text style={styles.calendarDotText}>{count > 1 ? count : ""}</Text></View>}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
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
  const [view, setView] = useState<ViewName>("home");
  const [filter, setFilter] = useState<ClosetFilter>("all");
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [productUrl, setProductUrl] = useState("");
  const [productPlacement, setProductPlacement] = useState<ProductPlacementHint>("auto");
  const [productImporting, setProductImporting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [reviewLoginOpen, setReviewLoginOpen] = useState(false);
  const [reviewEmail, setReviewEmail] = useState("");
  const [reviewPassword, setReviewPassword] = useState("");
  const [reviewSigningIn, setReviewSigningIn] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletingGarmentId, setDeletingGarmentId] = useState<ItemId | null>(null);
  const [deletingOutfitId, setDeletingOutfitId] = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallReason, setPaywallReason] = useState<PaywallReason | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarSelfie, setAvatarSelfie] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarFullBody, setAvatarFullBody] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [avatarConsent, setAvatarConsent] = useState(false);
  const [avatarGenerating, setAvatarGenerating] = useState(false);
  const [cloudAvatar, setCloudAvatar] = useState<CloudAvatar | null>(null);
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [editingGarment, setEditingGarment] = useState(false);
  const [savingGarment, setSavingGarment] = useState(false);
  const [garmentEditDraft, setGarmentEditDraft] = useState<GarmentEditDraft | null>(null);
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
  const [reconstructingId, setReconstructingId] = useState<ItemId | null>(null);
  const [cloudWardrobe, setCloudWardrobe] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitsLoading, setOutfitsLoading] = useState(false);
  const [calendarEntries, setCalendarEntries] = useState<CalendarEntry[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(() => calendarDateKey(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [schedulingOutfit, setSchedulingOutfit] = useState<Outfit | null>(null);
  const [calendarCustomDateOpen, setCalendarCustomDateOpen] = useState(false);
  const [calendarReturnToOutfit, setCalendarReturnToOutfit] = useState(false);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [outfitGenerating, setOutfitGenerating] = useState(false);
  const [outfitGenerationProgress, setOutfitGenerationProgress] = useState<{ current: number; total: number } | null>(null);
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
  const automaticCloudConnectionStarted = useRef(false);
  const importResumeStarted = useRef(false);
  const tryOnResumeStarted = useRef(false);
  const pendingAnalysisOffered = useRef(false);
  const avatarOnboardingOffered = useRef(false);
  const legacyAvatarMigrationStarted = useRef(false);

  function showNotice(title: string, message?: string, tone: AppNotice["tone"] = "info") {
    setNotice({ id: Date.now(), tone, title, message });
  }

  function openPremium(reason: PaywallReason | null = null) {
    setPaywallReason(reason);
    setPaywallOpen(true);
  }

  function requirePremium(reason: PaywallReason) {
    if (subscriptionStatus?.active) return true;
    openPremium(reason);
    return false;
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice((current) => current?.id === notice.id ? null : current), notice.tone === "error" ? 5200 : 3200);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!selectedItem) {
      setEditingGarment(false);
      setGarmentEditDraft(null);
      return;
    }
    setEditingGarment(false);
    setGarmentEditDraft(garmentDraftFor(selectedItem));
  }, [selectedItem?.id]);

  const activeWardrobe = cloudWardrobe;

  const visibleItems = useMemo(
    () => activeWardrobe.filter((item) => filter === "all"
      || item.category === filter
      || (filter === "clothing" && ["tops", "layers", "bottoms", "one_piece"].includes(item.category))),
    [activeWardrobe, filter],
  );
  const localWardrobeImages = useMemo(() => new Map(
    cloudWardrobe
      .filter((item): item is WardrobeItem & { localImageUri: string } => Boolean(item.localImageUri))
      .map((item) => [String(item.id), item.localImageUri]),
  ), [cloudWardrobe]);
  const photoBytes = useMemo(
    () => photos.reduce((total, photo) => total + (photo.fileSize ?? 0), 0),
    [photos],
  );
  const outfitsById = useMemo(() => new Map(outfits.map((outfit) => [outfit.id, outfit])), [outfits]);
  const calendarCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of calendarEntries) counts.set(entry.scheduledDate, (counts.get(entry.scheduledDate) || 0) + 1);
    return counts;
  }, [calendarEntries]);
  const selectedCalendarEntries = useMemo(
    () => calendarEntries.filter((entry) => entry.scheduledDate === calendarSelectedDate),
    [calendarEntries, calendarSelectedDate],
  );
  const quickCalendarDates = calendarQuickDates();

  async function redeemPairingUrl(url: string) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol === "vesta:" && parsed.hostname === "review") {
      setProfileOpen(false);
      setReviewLoginOpen(true);
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
    if (!cloudSession || pendingImport || pendingAnalysisOffered.current) return;
    pendingAnalysisOffered.current = true;
    resumePendingAnalysis(cloudSession).catch(() => {
      pendingAnalysisOffered.current = false;
    });
  }, [cloudSession?.deviceToken, pendingImport?.id]);

  useEffect(() => {
    if (!cloudSession) {
      setCloudWardrobe([]);
      setOutfits([]);
      setCalendarEntries([]);
      setCloudAvatar(null);
      setLocalAvatarUri(null);
      setSubscriptionStatus(null);
      pendingAnalysisOffered.current = false;
      avatarOnboardingOffered.current = false;
      legacyAvatarMigrationStarted.current = false;
      return;
    }
    Promise.all([loadWardrobe(cloudSession), loadOutfits(cloudSession), loadCalendar(cloudSession), loadAvatar(cloudSession), loadSubscriptionStatus(cloudSession)]).catch(() => undefined);
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken]);

  useEffect(() => {
    if (!cloudSession) return;
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") loadSubscriptionStatus(cloudSession).catch(() => undefined);
    });
    return () => listener.remove();
  }, [cloudSession?.apiUrl, cloudSession?.deviceToken]);

  useEffect(() => {
    if (!cloudSession || !outfits.some((outfit) => outfit.status === "rendering")) return;
    const interval = setInterval(() => loadOutfits(cloudSession).catch(() => undefined), 1800);
    return () => clearInterval(interval);
  }, [cloudSession?.deviceToken, outfits.some((outfit) => outfit.status === "rendering")]);

  useEffect(() => {
    if (!cloudSession || !cloudWardrobe.some((item) => item.status === "reconstructing")) return;
    const interval = setInterval(() => loadWardrobe(cloudSession).catch(() => undefined), 1800);
    return () => clearInterval(interval);
  }, [cloudSession?.deviceToken, cloudWardrobe.some((item) => item.status === "reconstructing")]);

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

  async function loadCalendar(session = cloudSession) {
    if (!session) return;
    setCalendarLoading(true);
    try {
      const response = await cloudFetch(session, "/api/v1/calendar", { method: "GET" });
      if (!response.ok) return;
      const result = await response.json() as { entries?: CalendarEntry[] };
      setCalendarEntries(Array.isArray(result.entries) ? result.entries : []);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function loadSubscriptionStatus(session = cloudSession) {
    if (!session) return;
    const response = await cloudFetch(session, "/api/v1/subscription", { method: "GET" });
    if (!response.ok) return;
    setSubscriptionStatus(await response.json() as SubscriptionStatus);
  }

  function changeCalendarMonth(offset: number) {
    setCalendarMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
      const selectedDay = calendarDateFromKey(calendarSelectedDate).getDate();
      const finalDay = Math.min(selectedDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate());
      setCalendarSelectedDate(calendarDateKey(new Date(next.getFullYear(), next.getMonth(), finalDay)));
      return next;
    });
  }

  function openCalendarForOutfit(outfit: Outfit, date = calendarSelectedDate) {
    const selected = calendarDateFromKey(date);
    setCalendarSelectedDate(date);
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarReturnToOutfit(selectedOutfit?.id === outfit.id);
    setSelectedOutfit(null);
    setCalendarPickerOpen(false);
    setCalendarCustomDateOpen(false);
    setSchedulingOutfit(outfit);
  }

  function closeCalendarScheduler(restoreOutfit = true) {
    const outfit = schedulingOutfit;
    setSchedulingOutfit(null);
    setCalendarCustomDateOpen(false);
    if (restoreOutfit && calendarReturnToOutfit && outfit) setSelectedOutfit(outfit);
    setCalendarReturnToOutfit(false);
  }

  async function saveCalendarEntry(date = calendarSelectedDate, outfit = schedulingOutfit) {
    if (!cloudSession || !outfit || calendarSaving) return;
    if (calendarEntries.some((entry) => entry.outfitId === outfit.id && entry.scheduledDate === date)) {
      setCalendarPickerOpen(false);
      closeCalendarScheduler();
      showNotice("Ya estaba programado", `${outfit.name} · ${calendarDateLabel(date)}`, "info");
      return;
    }

    const previousEntries = calendarEntries;
    const optimisticId = `pending-${outfit.id}-${date}`;
    const selected = calendarDateFromKey(date);
    setCalendarSelectedDate(date);
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarEntries((current) => [...current, {
      id: optimisticId,
      outfitId: outfit.id,
      scheduledDate: date,
      createdAt: new Date().toISOString(),
    }]);
    setCalendarPickerOpen(false);
    closeCalendarScheduler();
    setCalendarSaving(true);
    try {
      const response = await cloudFetch(cloudSession, "/api/v1/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outfitId: outfit.id, scheduledDate: date }),
      });
      const result = await response.json() as { entries?: CalendarEntry[]; error?: string };
      if (!response.ok) throw new Error(result.error || "calendar_save_failed");
      setCalendarEntries(Array.isArray(result.entries) ? result.entries : previousEntries);
      showNotice("Look programado", `${outfit.name} · ${calendarDateLabel(date)}`, "success");
    } catch {
      setCalendarEntries(previousEntries);
      showNotice("No se agregó al calendario", "Toca de nuevo cuando recuperes conexión.", "error");
    } finally {
      setCalendarSaving(false);
    }
  }

  async function removeCalendarEntry(entry: CalendarEntry) {
    if (!cloudSession) return;
    const previous = calendarEntries;
    setCalendarEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
    try {
      const response = await cloudFetch(cloudSession, `/api/v1/calendar/${entry.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("calendar_delete_failed");
      showNotice("Quitado del calendario", undefined, "success");
    } catch {
      setCalendarEntries(previous);
      showNotice("No se pudo quitar", "Comprueba tu conexión e inténtalo otra vez.", "error");
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
    const result = await response.json() as {
      avatar?: CloudAvatar | null;
      legacyAvatarEligible?: boolean;
      generation?: { requestId: string; status: "running" | "completed" | "failed"; error?: string | null } | null;
    };
    if (result.generation?.status === "running") {
      setAvatarGenerating(true);
      setAvatarOpen(false);
      setTimeout(() => loadAvatar(session).catch(() => undefined), 1400);
      return;
    }
    setAvatarGenerating(false);
    if (!result.avatar) {
      if (result.legacyAvatarEligible) {
        await restoreLegacyAvatar(session, cachedPath);
        return;
      }
      setCloudAvatar(null);
      setLocalAvatarUri(null);
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
  }

  async function restoreLegacyAvatar(session: CloudSession, cachedPath: string | null) {
    if (legacyAvatarMigrationStarted.current) return;
    legacyAvatarMigrationStarted.current = true;
    const bundledAvatar = Image.resolveAssetSource(legacyAlanAvatar);
    setAvatarOpen(false);
    setLocalAvatarUri(bundledAvatar.uri);
    try {
      const base64 = await FileSystem.readAsStringAsync(bundledAvatar.uri, { encoding: FileSystem.EncodingType.Base64 });
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

  async function generateSavedOutfits() {
    if (!cloudSession || outfitGenerating) return;
    if (!requirePremium("looks")) return;
    if (!localAvatarUri && !cloudAvatar) {
      showNotice("Crea tu avatar primero", "Solo necesitas una selfie y una foto de cuerpo completo.");
      setAvatarOpen(true);
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
    if (!requirePremium("looks")) return;
    if (!localAvatarUri && !cloudAvatar) {
      setSelectedOutfit(null);
      setAvatarOpen(true);
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
        const freshRenderPath = renderPath;
        setOutfits((current) => current.map((entry) => entry.id === outfit.id
          ? { ...entry, renderPath: freshRenderPath, localRenderUri, status: "ready" }
          : entry));
        setSelectedOutfit((current) => current?.id === outfit.id
          ? { ...current, renderPath: freshRenderPath, localRenderUri, status: "ready" }
          : current);
        completed += 1;
      } catch (error) {
        failed += 1;
        console.info("[Outfit Club look render]", error instanceof Error ? error.message : "unknown");
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
    return requestCloudOutfitRender(outfit.id, "low", `saved-${outfit.id}-${Date.now()}`, false);
  }

  async function requestCloudOutfitRender(outfitId: string, quality: TryOnRenderQuality, requestId: string, force: boolean) {
    if (!cloudSession) throw new Error("outfit_cloud_unavailable");
    const response = await cloudFetch(cloudSession, `/api/v1/outfits/${outfitId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, quality, force }),
    });
    const initial = await response.json() as { status?: string; renderPath?: string; error?: string };
    if (!response.ok && response.status !== 202) {
      if (response.status === 402 || response.status === 429) openPremium("try_on");
      throw new Error(initial.error || `outfit_generate_${response.status}`);
    }

    let renderPath = initial.renderPath || null;
    for (let attempt = 0; !renderPath && attempt < 150; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 12 ? 900 : 1500));
      const statusResponse = await cloudFetch(cloudSession, `/api/v1/outfits/${outfitId}/generate`, { method: "GET" });
      if (!statusResponse.ok) continue;
      const status = await statusResponse.json() as { status?: string; renderPath?: string; error?: string };
      if (status.status === "failed") throw new Error(status.error || "try_on_generation_failed");
      if (status.status === "completed" && status.renderPath) renderPath = status.renderPath;
    }
    if (!renderPath) throw new Error("try_on_still_running");

    const localRenderUri = outfitCachePath(cloudSession, outfitId);
    if (localRenderUri) {
      await FileSystem.deleteAsync(localRenderUri, { idempotent: true }).catch(() => undefined);
      const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${renderPath}`, localRenderUri, {
        headers: {
          "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
          "x-vesta-device-token": cloudSession.deviceToken,
        },
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      });
      if (download.status < 200 || download.status >= 300) throw new Error(`outfit_render_download_${download.status}`);
    }
    return { renderPath, localRenderUri };
  }

  async function resumePendingAnalysis(session: CloudSession) {
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
      const completed = await startProcessing(batchId, "economy");
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
    if (!requirePremium("wardrobe")) {
      setImportOpen(false);
      return;
    }
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
    if (kind === "selfie") setAvatarSelfie(result.assets[0]);
    else setAvatarFullBody(result.assets[0]);
  };

  const generateAvatarDraft = async () => {
    if (!cloudSession || !avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating) return;
    setAvatarGenerating(true);
    const temporaryPaths: string[] = [];
    try {
      const [selfie, fullBody] = await Promise.all([
        ImageManipulator.manipulateAsync(avatarSelfie.uri, [{ resize: { width: 1400 } }], { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG }),
        ImageManipulator.manipulateAsync(avatarFullBody.uri, [{ resize: { width: 1400 } }], { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG }),
      ]);
      temporaryPaths.push(selfie.uri, fullBody.uri);
      const form = new FormData();
      const requestId = `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      form.append("requestId", requestId);
      form.append("selfie", { uri: selfie.uri, name: "selfie.jpg", type: "image/jpeg" } as unknown as Blob);
      form.append("fullBody", { uri: fullBody.uri, name: "full-body.jpg", type: "image/jpeg" } as unknown as Blob);
      const response = await cloudFetch(cloudSession, "/api/v1/avatar", { method: "POST", body: form });
      const initial = await response.json() as { status?: string; error?: string };
      if (!response.ok && response.status !== 202) throw new Error(initial.error || "avatar_generation_failed");
      let payload: AvatarStatusPayload | null = null;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 12 ? 900 : 1500));
        const statusResponse = await cloudFetch(cloudSession, "/api/v1/avatar", { method: "GET" });
        if (!statusResponse.ok) continue;
        payload = await statusResponse.json() as AvatarStatusPayload;
        if (payload?.generation?.requestId !== requestId) continue;
        if (payload.generation.status === "failed") throw new Error(payload.generation.error || "avatar_generation_failed");
        if (payload.generation.status === "completed" && payload.avatar) break;
      }
      if (!payload?.avatar) throw new Error("avatar_still_running");
      const cachedPath = avatarCachePath(cloudSession);
      if (cachedPath) {
        await FileSystem.deleteAsync(cachedPath, { idempotent: true }).catch(() => undefined);
        const download = await FileSystem.downloadAsync(`${cloudSession.apiUrl}${payload.avatar.mediaPath}`, cachedPath, {
          headers: {
            "OAI-Sites-Authorization": `Bearer ${cloudSession.dispatchToken}`,
            "x-vesta-device-token": cloudSession.deviceToken,
          },
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        });
        if (download.status >= 200 && download.status < 300) setLocalAvatarUri(download.uri);
      }
      setCloudAvatar(payload.avatar);
      setAvatarSelfie(null);
      setAvatarFullBody(null);
      setAvatarConsent(false);
      setAvatarOpen(false);
      showNotice("Avatar listo", "Ya puedes vestirte con prendas y Looks completos.", "success");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      console.info("[Outfit Club avatar]", detail);
      showNotice("El avatar no terminó", "Tus fotos siguen en este teléfono. Puedes reintentarlo.", "error");
    } finally {
      await Promise.all(temporaryPaths.map((path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined)));
      setAvatarGenerating(false);
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
            await clearTryOn();
            setAvatarOpen(false);
            showNotice("Avatar eliminado", "Tus Looks guardados permanecen intactos.", "success");
          },
        },
      ],
    );
  };

  const saveGarmentMetadata = async () => {
    if (!cloudSession || !selectedItem || !garmentEditDraft || savingGarment) return;
    const name = garmentEditDraft.name.replace(/\s+/gu, " ").trim();
    const color = garmentEditDraft.color.replace(/\s+/gu, " ").trim();
    if (!name || !color) {
      showNotice("Completa la información", "El nombre y el color principal son obligatorios.", "error");
      return;
    }
    const tags = Array.from(new Set(garmentEditDraft.tagsText
      .split(",")
      .map((tag) => tag.replace(/\s+/gu, " ").trim())
      .filter(Boolean)
      .map((tag) => tag.slice(0, 30))))
      .slice(0, 12);
    setSavingGarment(true);
    try {
      const response = await cloudFetch(cloudSession, `/api/v1/garments/${selectedItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: garmentEditDraft.category,
          color,
          secondaryColor: garmentEditDraft.secondaryColor.replace(/\s+/gu, " ").trim() || null,
          tags,
        }),
      });
      const payload = await response.json() as { error?: string; garment?: Partial<CloudGarment> & { id: string } };
      if (!response.ok || !payload.garment) throw new Error(payload.error || "garment_update_failed");
      const updated: WardrobeItem = {
        ...selectedItem,
        ...payload.garment,
        category: categoryForUi(payload.garment.category || selectedItem.category),
      };
      const nextWardrobe = cloudWardrobe.map((item) => String(item.id) === String(updated.id)
        ? { ...item, ...updated, localImageUri: item.localImageUri }
        : item);
      setCloudWardrobe(nextWardrobe);
      setSelectedItem(updated);
      setTryOnLayers((current) => current.map((layer) => String(layer.item.id) === String(updated.id)
        ? { ...layer, item: { ...layer.item, ...updated } }
        : layer));
      setOutfits((current) => current.map((outfit) => ({
        ...outfit,
        pieces: outfit.pieces.map((piece) => String(piece.id) === String(updated.id) ? { ...piece, ...updated } : piece),
      })));
      await persistWardrobeCache(cloudSession, nextWardrobe);
      setGarmentEditDraft(garmentDraftFor(updated));
      setEditingGarment(false);
      showNotice("Prenda actualizada", "Los cambios ya aparecen en tu armario y tus Looks.", "success");
    } catch {
      showNotice("No pudimos guardar los cambios", "Comprueba tu conexión e inténtalo otra vez.", "error");
    } finally {
      setSavingGarment(false);
    }
  };

  const deleteGarment = (item: WardrobeItem) => {
    if (!cloudSession || deletingGarmentId !== null) return;
    Alert.alert(
      `¿Eliminar ${item.name}?`,
      "Se quitará de tu armario y del probador. Las fotografías de Looks que ya terminaste permanecen como recuerdos.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar prenda",
          style: "destructive",
          onPress: async () => {
            setDeletingGarmentId(item.id);
            try {
              const response = await cloudFetch(cloudSession, `/api/v1/garments/${item.id}`, { method: "DELETE" });
              if (!response.ok) throw new Error("garment_delete_failed");
              const nextWardrobe = cloudWardrobe.filter((entry) => String(entry.id) !== String(item.id));
              setCloudWardrobe(nextWardrobe);
              setTryOnLayers((current) => current.filter((layer) => String(layer.item.id) !== String(item.id)));
              setSelectedItem(null);
              if (item.localImageUri?.startsWith("file:")) {
                await FileSystem.deleteAsync(item.localImageUri, { idempotent: true }).catch(() => undefined);
              }
              await persistWardrobeCache(cloudSession, nextWardrobe);
              showNotice("Prenda eliminada", undefined, "success");
            } catch {
              showNotice("No se eliminó la prenda", "Comprueba tu conexión e inténtalo otra vez.", "error");
            } finally {
              setDeletingGarmentId(null);
            }
          },
        },
      ],
    );
  };

  const deleteOutfit = (outfit: Outfit) => {
    if (!cloudSession || deletingOutfitId !== null) return;
    Alert.alert(
      `¿Eliminar ${outfit.name}?`,
      "Se eliminará esta fotografía y su combinación guardada.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar Look",
          style: "destructive",
          onPress: async () => {
            setDeletingOutfitId(outfit.id);
            try {
              const response = await cloudFetch(cloudSession, `/api/v1/outfits/${outfit.id}`, { method: "DELETE" });
              if (!response.ok) throw new Error("outfit_delete_failed");
              const nextOutfits = outfits.filter((entry) => entry.id !== outfit.id);
              setOutfits(nextOutfits);
              setCalendarEntries((current) => current.filter((entry) => entry.outfitId !== outfit.id));
              setSelectedOutfit(null);
              const localPath = outfit.localRenderUri || outfitCachePath(cloudSession, outfit.id);
              if (localPath?.startsWith("file:")) {
                await FileSystem.deleteAsync(localPath, { idempotent: true }).catch(() => undefined);
              }
              const indexPath = outfitIndexCachePath(cloudSession);
              if (indexPath) await FileSystem.writeAsStringAsync(indexPath, JSON.stringify(nextOutfits));
              showNotice("Look eliminado", undefined, "success");
            } catch {
              showNotice("No se eliminó el Look", "Comprueba tu conexión e inténtalo otra vez.", "error");
            } finally {
              setDeletingOutfitId(null);
            }
          },
        },
      ],
    );
  };

  const deleteAccount = () => {
    if (!cloudSession || deletingAccount) return;
    Alert.alert(
      "¿Eliminar tu cuenta y todos tus datos?",
      "Se borrarán definitivamente el avatar, las fotos, las prendas y los Looks de tu nube privada. Si tienes una suscripción de Apple, debes cancelarla por separado.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Administrar suscripción", onPress: () => Linking.openURL("https://apps.apple.com/account/subscriptions").catch(() => undefined) },
        {
          text: "Eliminar todo",
          style: "destructive",
          onPress: async () => {
            const session = cloudSession;
            setDeletingAccount(true);
            try {
              const response = await cloudFetch(session, "/api/v1/account", { method: "DELETE" });
              if (!response.ok) throw new Error("account_delete_failed");
              await Promise.all([
                ...Object.values(cloudKeys).map((key) => SecureStore.deleteItemAsync(key).catch(() => undefined)),
                clearPrivateLocalData(),
              ]);
              setCloudSession(null);
              setCloudWardrobe([]);
              setOutfits([]);
              setCalendarEntries([]);
              setCloudAvatar(null);
              setLocalAvatarUri(null);
              setPhotos([]);
              setPendingImport(null);
              setPendingTryOn(null);
              setTryOnLayers([]);
              setTryOnRenderedUri(null);
              setTryOnRenderedSignature(null);
              setTryOnSavedOutfitId(null);
              setSelectedItem(null);
              setSelectedOutfit(null);
              setAvatarOpen(false);
              setReviewEmail("");
              setReviewPassword("");
              automaticCloudConnectionStarted.current = false;
              pendingAnalysisOffered.current = false;
              setProfileOpen(true);
              showNotice("Cuenta eliminada", "Tus datos privados ya no están en Outfit Club.", "success");
            } catch {
              showNotice("No pudimos eliminar la cuenta", "No se borró parcialmente: inténtalo otra vez con conexión.", "error");
            } finally {
              setDeletingAccount(false);
            }
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
    if (!requirePremium("wardrobe")) {
      setLinkImportOpen(false);
      return;
    }
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
        ...previousLayers.filter((layer) => layer.item.id !== item.id && !fittingSlotsConflict(fittingSlot, fittingSlotFor(layer.item))),
        { key: `${item.id}-web-${Date.now()}`, item },
      ];
      setTryOnLayers(nextLayers);
      setSelectedItem(null);
      setLinkImportOpen(false);
      setProductUrl("");
      setProductPlacement("auto");
      setView("builder");

      if (!localAvatarUri && !cloudAvatar) {
        showNotice("Prenda guardada", "Crea tu avatar para verla puesta.", "success");
        setAvatarOpen(true);
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
      const completed = await startProcessing(queue.batchId!, "economy");
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
      const items = await loadWardrobe(cloudSession) || [];
      const queued = await queueAutomaticReconstructions(items);
      setImportStage("complete");
      setImportMessage(queued > 0
        ? `${result.garmentCount ?? 0} prendas añadidas. ${queued} imágenes se están preparando en segundo plano.`
        : `${result.garmentCount ?? 0} prendas añadidas a tu armario.`);
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

  const queueAutomaticReconstructions = async (items: WardrobeItem[]) => {
    if (!cloudSession) return 0;
    const candidates = items.filter((item) => (
      item.status === "candidate"
      && !item.isBasic
      && Boolean(item.evidencePath)
      && item.sourceType !== "internet"
    ));
    let queued = 0;
    await runPool(candidates, 3, async (item) => {
      const response = await cloudFetch(cloudSession, `/api/v1/garments/${item.id}/reconstruct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "draft",
          consent: true,
          acknowledgesOpenAIRetention: true,
        }),
      });
      if (response.ok || response.status === 202) queued += 1;
    });
    if (queued > 0) {
      const candidateIds = new Set(candidates.map((item) => String(item.id)));
      setCloudWardrobe((current) => current.map((item) => candidateIds.has(String(item.id))
        ? { ...item, status: "reconstructing" }
        : item));
    }
    return queued;
  };

  const chooseReconstruction = (item: WardrobeItem) => {
    if (item.isBasic) {
      showNotice("Básico reconocido", "Conservamos la foto real sin gastar una generación.");
      return;
    }
    startReconstruction(item, "draft").catch(() => undefined);
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
      const result = await response.json() as { error?: string; status?: string; jobId?: string };
      if (response.status === 503 && result.error === "processing_not_configured") {
        showNotice("Imagen pendiente", "El procesamiento no está disponible todavía. No se realizó ningún cargo.", "error");
        return;
      }
      if (!response.ok) throw new Error(result.error || "reconstruction_failed");
      const pending = { ...item, status: "reconstructing" };
      setCloudWardrobe((current) => current.map((entry) => String(entry.id) === String(item.id) ? pending : entry));
      setSelectedItem(pending);
      showNotice("Preparando la prenda", "Puedes cerrar la app; aparecerá lista en tu armario.", "success");
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

  const renderRealTryOn = async (
    layers: TryOnLayer[],
    _previousLayers: TryOnLayer[],
    quality: TryOnRenderQuality = "low",
    queuedJob?: PendingTryOnQueue,
  ) => {
    if (!cloudSession || !FileSystem.documentDirectory) return;
    tryOnResumeStarted.current = true;
    setTryOnRenderingQuality(quality);
    setTryOnRendering(true);
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
      const result = await requestCloudOutfitRender(outfitId, quality, queue.id, quality === "medium");
      const previousRender = tryOnRenderedUri;
      setTryOnRenderedUri(result.localRenderUri);
      setTryOnRenderedSignature(tryOnSignatureFor(layers));
      setTryOnResultQuality(quality);
      setTryOnSavedOutfitId(outfitId);
      setOutfits((current) => current.map((entry) => entry.id === outfitId
        ? { ...entry, renderPath: result.renderPath, localRenderUri: result.localRenderUri, status: "ready" }
        : entry));
      if (previousRender?.startsWith("file:") && previousRender !== result.localRenderUri) {
        await FileSystem.deleteAsync(previousRender, { idempotent: true }).catch(() => undefined);
      }
      await clearTryOnQueue();
      setPendingTryOn(null);
      tryOnResumeStarted.current = false;
      await loadOutfits(cloudSession).catch(() => undefined);
      showNotice("Look terminado", "La foto quedó guardada automáticamente en Looks.", "success");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      if (detail === "avatar_required") {
        showNotice("Crea tu avatar primero", "El probador necesita una selfie y una foto de cuerpo completo.");
        setAvatarOpen(true);
      } else if (detail === "moderation_blocked") {
        await clearTryOnQueue();
        setPendingTryOn(null);
        showNotice("No se pudo crear esta prueba", "Tu avatar y tus prendas siguen intactos.", "error");
      } else if (detail === "try_on_still_running") {
        showNotice("El Look sigue creándose", "Puedes cerrar la app; aparecerá en Looks cuando termine.");
      } else {
        console.info("[Outfit Club try-on]", detail);
        showNotice("Creación pausada", "Tu outfit quedó guardado y continuará automáticamente cuando vuelvas a abrir la app.", "error");
      }
    } finally {
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
    if (!localAvatarUri && !cloudAvatar) return;
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
    cloudAvatar?.version,
    localAvatarUri,
    cloudWardrobe,
    wardrobeLoading,
    tryOnRendering,
    tryOnResumeEpoch,
  ]);

  const addToTryOn = (item: WardrobeItem) => {
    if (tryOnRendering) return;
    if (!requirePremium("try_on")) {
      setSelectedItem(null);
      return;
    }
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
      ...previousLayers.filter((layer) => !fittingSlotsConflict(fittingSlot, fittingSlotFor(layer.item))),
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
    if (!requirePremium("try_on")) return;
    if (!localAvatarUri && !cloudAvatar) {
      showNotice("Crea tu avatar primero", "Después podrás usarlo con todas tus prendas sin volver a configurarlo.");
      setAvatarOpen(true);
      return;
    }
    renderRealTryOn(tryOnLayers, tryOnLayers, "low").catch(() => undefined);
  };

  const improveTryOnQuality = () => {
    if (tryOnRendering || !tryOnLayers.length) return;
    if (!requirePremium("try_on")) return;
    renderRealTryOn(tryOnLayers, tryOnLayers, "medium").catch(() => undefined);
  };

  const trySavedOutfit = (outfit: Outfit) => {
    if (!requirePremium("try_on")) {
      setSelectedOutfit(null);
      return;
    }
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
          <Pressable onPress={() => setView("home")} style={styles.brand} accessibilityLabel="Ir a Home">
            <View style={styles.brandMark}><Text style={styles.brandLetter}>OC</Text></View>
            <Text style={styles.brandName}>OUTFIT CLUB</Text>
          </Pressable>
            <View style={styles.cloudBadge}>
            <View style={cloudSession ? styles.greenDot : styles.rustDot} />
            <Text style={[styles.cloudBadgeText, !cloudSession && styles.cloudBadgePending]}>{tryOnRendering ? "CREANDO LOOK…" : avatarGenerating ? "CREANDO AVATAR…" : processing ? "ANALIZANDO…" : reconstructingId ? "PREPARANDO PRENDA…" : cloudSession ? "CUENTA PROTEGIDA" : "PREPARANDO CUENTA…"}</Text>
          </View>
          <Pressable style={styles.avatar} onPress={() => setView("profile")} accessibilityLabel="Ir a Perfil">
            {avatarDisplaySource
              ? <Image source={avatarDisplaySource} resizeMode="cover" style={styles.avatarThumb} />
              : <Text style={styles.avatarText}>YO</Text>}
          </Pressable>
        </View>

        {view === "home" && (
          <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
            <View style={styles.homeHero}>
              <Text style={styles.eyebrow}>TU ESTILO, EN UN SOLO LUGAR</Text>
              <Text style={styles.homeTitle}>¿Qué te vas a poner hoy?</Text>
              <Text style={styles.homeIntro}>Organiza tu ropa, crea atuendos y vuelve a usar tus mejores combinaciones.</Text>
              <Pressable style={styles.homePrimaryAction} onPress={() => setCreateMenuOpen(true)}>
                <Text style={styles.homePrimaryActionText}>＋ Crear algo nuevo</Text>
              </Pressable>
            </View>

            <View style={styles.homeSectionHeading}>
              <View><Text style={styles.eyebrow}>HOY</Text><Text style={styles.homeSectionTitle}>Tu calendario</Text></View>
              <Pressable onPress={() => { setCalendarSelectedDate(calendarDateKey(new Date())); setView("calendar"); }}><Text style={styles.homeSectionLink}>Ver calendario</Text></Pressable>
            </View>
            {calendarEntries.filter((entry) => entry.scheduledDate === calendarDateKey(new Date())).length ? (
              <View style={styles.homeTodayList}>
                {calendarEntries.filter((entry) => entry.scheduledDate === calendarDateKey(new Date())).slice(0, 2).map((entry) => {
                  const outfit = outfitsById.get(entry.outfitId);
                  if (!outfit) return null;
                  return (
                    <Pressable key={entry.id} style={styles.homeTodayCard} onPress={() => setSelectedOutfit(outfit)}>
                      <View style={styles.homeTodayThumb}><OutfitVisual outfit={outfit} session={cloudSession} localPieceImages={localWardrobeImages} /></View>
                      <View style={styles.homeTodayCopy}><Text style={styles.homeTodayEyebrow}>ATUENDO DE HOY</Text><Text style={styles.homeTodayName}>{outfit.name}</Text><Text style={styles.homeTodayMeta}>{outfit.pieces.length} prendas</Text></View>
                      <Text style={styles.homeCardArrow}>›</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Pressable style={styles.homeEmptyCalendar} onPress={() => setView("calendar")}>
                <Text style={styles.homeEmptyCalendarIcon}>□</Text>
                <View style={styles.homeEmptyCalendarCopy}><Text style={styles.homeEmptyCalendarTitle}>Hoy está libre</Text><Text style={styles.homeEmptyCalendarMeta}>Agrega un outfit al calendario cuando quieras planearlo.</Text></View>
                <Text style={styles.homeCardArrow}>›</Text>
              </Pressable>
            )}

            <View style={styles.homeSectionHeading}>
              <View><Text style={styles.eyebrow}>RECIENTES</Text><Text style={styles.homeSectionTitle}>Tus últimos outfits</Text></View>
              <Pressable onPress={() => setView("looks")}><Text style={styles.homeSectionLink}>Ver todos</Text></Pressable>
            </View>
            {outfits.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.homeLooksRail}>
                {outfits.slice(0, 5).map((outfit) => (
                  <Pressable key={outfit.id} style={styles.homeLookCard} onPress={() => setSelectedOutfit(outfit)}>
                    <View style={styles.homeLookVisual}><OutfitVisual outfit={outfit} session={cloudSession} localPieceImages={localWardrobeImages} /></View>
                    <Text style={styles.homeLookName} numberOfLines={1}>{outfit.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Pressable style={styles.homeEmptyLooks} onPress={() => setView("builder")}>
                <Text style={styles.homeEmptyLooksTitle}>Crea tu primer atuendo</Text>
                <Text style={styles.homeEmptyLooksCopy}>Combina las prendas de tu guardarropa y guárdalo en Outfits.</Text>
              </Pressable>
            )}
          </ScrollView>
        )}

        {view === "profile" && (
          <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
            <View style={styles.profileHubHeader}>
              <View style={styles.profileHubAvatar}>
                {avatarDisplaySource ? <Image source={avatarDisplaySource} resizeMode="cover" style={styles.profileHubAvatarImage} /> : <Text style={styles.profileAvatarText}>YO</Text>}
              </View>
              <Text style={styles.eyebrow}>TU ESPACIO PERSONAL</Text>
              <Text style={styles.pageTitle}>Perfil</Text>
              <Text style={styles.profileHubIntro}>Tus prendas, outfits y cosas que quieres probar, organizadas en un solo lugar.</Text>
            </View>
            <View style={styles.profileLibrary}>
              <Pressable style={styles.profileLibraryRow} onPress={() => setView("closet")}>
                <View style={styles.profileLibraryIcon}><Text style={styles.profileLibraryIconText}>▦</Text></View>
                <View style={styles.profileLibraryCopy}><Text style={styles.profileLibraryTitle}>Mi guardarropa</Text><Text style={styles.profileLibraryMeta}>{activeWardrobe.length} {activeWardrobe.length === 1 ? "prenda" : "prendas"}</Text></View>
                <Text style={styles.profileLibraryArrow}>›</Text>
              </Pressable>
              <Pressable style={styles.profileLibraryRow} onPress={() => setView("looks")}>
                <View style={styles.profileLibraryIcon}><Text style={styles.profileLibraryIconText}>▤</Text></View>
                <View style={styles.profileLibraryCopy}><Text style={styles.profileLibraryTitle}>Outfits</Text><Text style={styles.profileLibraryMeta}>{outfits.length} {outfits.length === 1 ? "outfit guardado" : "outfits guardados"}</Text></View>
                <Text style={styles.profileLibraryArrow}>›</Text>
              </Pressable>
              <Pressable style={styles.profileLibraryRow} onPress={() => setView("wishlist")}>
                <View style={styles.profileLibraryIcon}><Text style={styles.profileLibraryIconText}>♡</Text></View>
                <View style={styles.profileLibraryCopy}><Text style={styles.profileLibraryTitle}>Lista de deseos</Text><Text style={styles.profileLibraryMeta}>Prendas que quieres probar después</Text></View>
                <Text style={styles.profileLibraryArrow}>›</Text>
              </Pressable>
            </View>
            <Pressable style={styles.profileSettingsButton} onPress={() => setProfileOpen(true)}>
              <Text style={styles.profileSettingsText}>Cuenta, avatar y privacidad</Text><Text style={styles.profileLibraryArrow}>›</Text>
            </Pressable>
          </ScrollView>
        )}

        {view === "wishlist" && (
          <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
            <View style={styles.headingRow}>
              <View><Text style={styles.eyebrow}>PARA PROBAR DESPUÉS</Text><Text style={styles.pageTitle}>Lista de deseos</Text></View>
            </View>
            <View style={styles.wishlistEmpty}>
              <Text style={styles.wishlistEmptyIcon}>♡</Text>
              <Text style={styles.emptyCollectionTitle}>Tu lista está vacía.</Text>
              <Text style={styles.emptyCollectionCopy}>Aquí podrás guardar prendas que te gusten sin mezclarlas con lo que ya tienes.</Text>
              <Pressable style={styles.wishlistBrowseButton} onPress={() => { setCreateMenuOpen(true); }}><Text style={styles.wishlistBrowseButtonText}>Agregar desde el ＋</Text></Pressable>
            </View>
          </ScrollView>
        )}

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
                  <Pressable style={styles.importButton} onPress={() => requirePremium("wardrobe") && setImportOpen(true)}>
                    <Text style={styles.importButtonText}>＋ Importar</Text>
                  </Pressable>
                </View>
                {importStage !== "idle" && (
                  <Pressable
                    style={[styles.batchBanner, importStage === "error" && styles.batchBannerError]}
                    onPress={() => {
                      if (importStage === "error" && pendingImport && requirePremium("wardrobe")) setImportOpen(true);
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
                              ? "Analizando tus fotos"
                              : importStage === "complete" ? "Armario actualizado" : "Importación pausada"}</Text>
                      <Text style={styles.batchMeta}>{importMessage}</Text>
                      {(importStage === "uploading" || importStage === "analyzing") && (
                        <View style={styles.importProgressTrack}>
                          <View style={[styles.importProgressFill, { width: `${importStage === "uploading" ? uploadProgress : 42}%` }]} />
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
              onPress={() => requirePremium("wardrobe") && setLinkImportOpen(true)}
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
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            updateCellsBatchingPeriod={16}
            windowSize={5}
            removeClippedSubviews
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
                localPieceImages={localWardrobeImages}
              />
            )}
          />
        )}

        {view === "calendar" && (
          <ScrollView contentContainerStyle={styles.screenContent} showsVerticalScrollIndicator={false}>
            <View style={styles.headingRow}>
              <View>
                <Text style={styles.eyebrow}>PLANEA QUÉ VESTIR</Text>
                <Text style={styles.pageTitle}>Calendario</Text>
              </View>
              <Pressable style={[styles.importButton, !outfits.length && styles.disabledButton]} onPress={() => setCalendarPickerOpen(true)} disabled={!outfits.length}>
                <Text style={styles.importButtonText}>＋ LOOK</Text>
              </Pressable>
            </View>
            <Text style={styles.looksIntro}>Guarda un outfit en una fecha y vuelve a abrirlo cuando llegue el día. No consume una generación adicional.</Text>
            <CalendarMonthGrid
              month={calendarMonth}
              selectedDate={calendarSelectedDate}
              counts={calendarCounts}
              onChangeMonth={changeCalendarMonth}
              onSelectDate={setCalendarSelectedDate}
            />
            <View style={styles.calendarAgendaHeader}>
              <View>
                <Text style={styles.eyebrow}>AGENDA</Text>
                <Text style={styles.calendarSelectedTitle}>{calendarDateLabel(calendarSelectedDate)}</Text>
              </View>
              <Text style={styles.calendarAgendaCount}>{selectedCalendarEntries.length} {selectedCalendarEntries.length === 1 ? "Look" : "Looks"}</Text>
            </View>
            {calendarLoading && !calendarEntries.length ? (
              <View style={styles.calendarEmpty}><ActivityIndicator color={rust} /></View>
            ) : selectedCalendarEntries.length === 0 ? (
              <Pressable style={styles.calendarEmpty} onPress={() => outfits.length && setCalendarPickerOpen(true)}>
                <Text style={styles.calendarEmptyIcon}>＋</Text>
                <Text style={styles.calendarEmptyTitle}>Este día está libre.</Text>
                <Text style={styles.calendarEmptyCopy}>{outfits.length ? "Toca para elegir un Look guardado." : "Crea un Look y después podrás programarlo aquí."}</Text>
              </Pressable>
            ) : (
              <View style={styles.calendarAgendaList}>
                {selectedCalendarEntries.map((entry) => {
                  const outfit = outfitsById.get(entry.outfitId);
                  if (!outfit) return null;
                  return (
                    <View key={entry.id} style={styles.calendarAgendaCard}>
                      <Pressable style={styles.calendarAgendaOpen} onPress={() => setSelectedOutfit(outfit)}>
                        <View style={styles.calendarAgendaThumb}><OutfitVisual outfit={outfit} session={cloudSession} localPieceImages={localWardrobeImages} /></View>
                        <View style={styles.calendarAgendaCopy}>
                          <Text style={styles.calendarAgendaEyebrow}>{outfit.occasion.toUpperCase()}</Text>
                          <Text style={styles.calendarAgendaName}>{outfit.name}</Text>
                          <Text style={styles.calendarAgendaMeta}>{outfit.pieces.length} prendas · abrir Look</Text>
                        </View>
                      </Pressable>
                      <Pressable style={styles.calendarAgendaRemove} onPress={() => removeCalendarEntry(entry)} accessibilityLabel={`Quitar ${outfit.name} del calendario`}><Text style={styles.calendarAgendaRemoveText}>×</Text></Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}

        <View style={styles.bottomNav}>
          <Pressable style={styles.navItem} onPress={() => setView("home")}>
            <Text style={[styles.navIcon, view === "home" && styles.navActive]}>⌂</Text><Text style={[styles.navLabel, view === "home" && styles.navActive]}>Home</Text>
          </Pressable>
          <Pressable style={styles.navCreate} onPress={() => setCreateMenuOpen(true)} accessibilityLabel="Agregar o crear">
            <Text style={styles.navCreateIcon}>＋</Text>
          </Pressable>
          <Pressable style={styles.navItem} onPress={() => setView("profile")}>
            <Text style={[styles.navIcon, ["profile", "closet", "looks", "wishlist"].includes(view) && styles.navActive]}>○</Text><Text style={[styles.navLabel, ["profile", "closet", "looks", "wishlist"].includes(view) && styles.navActive]}>Perfil</Text>
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

      <Modal visible={createMenuOpen} transparent animationType="fade" onRequestClose={() => setCreateMenuOpen(false)}>
        <Pressable style={styles.createMenuBackdrop} onPress={() => setCreateMenuOpen(false)}>
          <Pressable style={styles.createMenuSheet} onPress={() => undefined}>
            <View style={styles.createMenuHandle} />
            <Text style={styles.createMenuEyebrow}>¿QUÉ QUIERES HACER?</Text>
            <Text style={styles.createMenuTitle}>Crear</Text>
            <Pressable style={styles.createMenuAction} onPress={() => {
              setCreateMenuOpen(false);
              if (requirePremium("wardrobe")) {
                setView("closet");
                setImportOpen(true);
              }
            }}>
              <View style={styles.createMenuActionIcon}><Text style={styles.createMenuActionIconText}>＋</Text></View>
              <View style={styles.createMenuActionCopy}><Text style={styles.createMenuActionTitle}>Agregar ropa</Text><Text style={styles.createMenuActionMeta}>Desde tus fotos o una tienda en internet</Text></View>
              <Text style={styles.createMenuActionArrow}>›</Text>
            </Pressable>
            <Pressable style={styles.createMenuAction} onPress={() => { setCreateMenuOpen(false); setView("builder"); }}>
              <View style={styles.createMenuActionIcon}><Text style={styles.createMenuActionIconText}>✦</Text></View>
              <View style={styles.createMenuActionCopy}><Text style={styles.createMenuActionTitle}>Crear atuenda</Text><Text style={styles.createMenuActionMeta}>Combina varias prendas y pruébatelas</Text></View>
              <Text style={styles.createMenuActionArrow}>›</Text>
            </Pressable>
            <Pressable style={styles.createMenuCancel} onPress={() => setCreateMenuOpen(false)}><Text style={styles.createMenuCancelText}>Cancelar</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
              <Text style={styles.modalTitle}>{cloudSession ? "Tu nube privada." : "Tu armario, siempre contigo."}</Text>
              <Text style={styles.modalIntro}>{cloudSession
                ? "Tu avatar, armario y Looks están sincronizados automáticamente y protegidos por tu cuenta."
                : "Continúa una sola vez para crear tu espacio privado y sincronizarlo en este iPhone."}</Text>
              {cloudSession && <Pressable style={styles.premiumCard} onPress={() => { setProfileOpen(false); openPremium(null); }}>
                <View style={styles.premiumCardIcon}><Text style={styles.premiumCardIconText}>OC</Text></View>
                <View style={styles.premiumCardCopy}>
                  <Text style={styles.premiumCardEyebrow}>OUTFIT CLUB PREMIUM</Text>
                  <Text style={styles.premiumCardTitle}>Ver planes y administrar pagos</Text>
                </View>
                <Text style={styles.premiumCardArrow}>›</Text>
              </Pressable>}
              <Pressable style={styles.secondaryButton} onPress={() => { setProfileOpen(false); setPrivacyOpen(true); }}>
                <Text style={styles.secondaryButtonText}>Política de privacidad</Text>
              </Pressable>
              {!cloudSession && (
                <Pressable
                  style={[styles.fullButton, pairing && styles.disabledButton]}
                  onPress={startCloudConnection}
                  onLongPress={() => { setProfileOpen(false); setReviewLoginOpen(true); }}
                  delayLongPress={1200}
                  disabled={pairing}
                >
                  <Text style={styles.fullButtonText}>{pairing ? "Abriendo acceso…" : "Continuar"}</Text>
                </Pressable>
              )}
              {cloudSession && (
                <Pressable style={[styles.fullButton, styles.avatarProfileButton]} onPress={() => { setProfileOpen(false); setAvatarOpen(true); }}>
                  <Text style={styles.fullButtonText}>{avatarDisplaySource ? "Administrar mi avatar" : "Crear mi avatar"}</Text>
                </Pressable>
              )}
              {cloudSession && (
                <Pressable onPress={deleteAccount} disabled={deletingAccount}>
                  <Text style={[styles.deleteText, deletingAccount && styles.disabledText]}>{deletingAccount ? "Eliminando cuenta y datos…" : "Eliminar cuenta y todos mis datos"}</Text>
                </Pressable>
              )}
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

      <SubscriptionPaywall
        visible={paywallOpen}
        reason={paywallReason}
        onClose={() => { setPaywallOpen(false); setPaywallReason(null); }}
        onStatusChange={setSubscriptionStatus}
        cloud={cloudSession}
      />
      <PrivacyPolicyModal visible={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      <Modal visible={avatarOpen} transparent animationType="slide" onRequestClose={() => setAvatarOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.avatarSheet}>
            <Pressable style={styles.closeButton} onPress={() => setAvatarOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.avatarSheetContent}>
              <Text style={[styles.eyebrow, styles.centerText]}>IDENTIDAD PRIVADA</Text>
              <Text style={styles.modalTitle}>{avatarDisplaySource ? "Actualiza tu avatar." : "Crea tu avatar."}</Text>
              <Text style={styles.modalIntro}>Elige una selfie clara y una foto de cuerpo completo. Outfit Club creará una base neutral reutilizable para el probador.</Text>
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
                    <Text style={styles.avatarConsentText}>Soy la persona de ambas fotos o tengo su permiso. Se usarán una sola vez para crear mi avatar privado y no se guardarán como referencias.</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.fullButton, styles.avatarConfirmButton, (!avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating) && styles.disabledButton]}
                    onPress={generateAvatarDraft}
                    disabled={!avatarSelfie || !avatarFullBody || !avatarConsent || avatarGenerating}
                  >
                    {avatarGenerating ? <ActivityIndicator color={paper} /> : <Text style={styles.fullButtonText}>✦ Crear mi avatar</Text>}
                  </Pressable>
                  <Text style={styles.avatarPrivacyCopy}>Se crea una sola base reutilizable. Después cada outfit usa ese avatar sin pedirte las fotos otra vez.</Text>
                  {avatarDisplaySource && <Pressable onPress={deleteAccountAvatar}><Text style={styles.deleteText}>Eliminar avatar actual</Text></Pressable>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(selectedItem)} transparent animationType="slide" onRequestClose={() => !savingGarment && setSelectedItem(null)}>
        <View style={styles.detailBackdrop}>
          <View style={styles.detailSheet}>
            <Pressable style={styles.closeButton} onPress={() => setSelectedItem(null)} disabled={savingGarment}><Text style={styles.closeText}>×</Text></Pressable>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {selectedItem && <GarmentVisual item={selectedItem} session={cloudSession} />}
              {selectedItem && garmentEditDraft && (
                <View style={styles.detailCopy}>
                  {editingGarment ? (
                    <View style={styles.garmentEditor}>
                      <Text style={styles.eyebrow}>EDITAR PRENDA</Text>
                      <Text style={styles.detailTitle}>Hazla tuya.</Text>
                      <Text style={styles.editorIntro}>Corrige la información una vez y se actualizará en tu armario, probador y Looks.</Text>

                      <Text style={styles.editorLabel}>NOMBRE</Text>
                      <TextInput
                        style={styles.editorInput}
                        value={garmentEditDraft.name}
                        onChangeText={(name) => setGarmentEditDraft((current) => current ? { ...current, name } : current)}
                        placeholder="Nombre de la prenda"
                        placeholderTextColor="#9B9386"
                        maxLength={100}
                      />

                      <Text style={styles.editorLabel}>CATEGORÍA</Text>
                      <View style={styles.editorCategoryGrid}>
                        {garmentCategoryOptions.map((option) => (
                          <Pressable
                            key={option.id}
                            style={[styles.editorCategory, garmentEditDraft.category === option.id && styles.editorCategoryActive]}
                            onPress={() => setGarmentEditDraft((current) => current ? { ...current, category: option.id } : current)}
                          >
                            <Text style={[styles.editorCategoryText, garmentEditDraft.category === option.id && styles.editorCategoryTextActive]}>{option.label}</Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.editorLabel}>COLOR PRINCIPAL</Text>
                      <View style={styles.editorColorRow}>
                        <View style={[styles.editorColorSwatch, { backgroundColor: colorPreview(garmentEditDraft.color) }]} />
                        <TextInput
                          style={[styles.editorInput, styles.editorColorInput]}
                          value={garmentEditDraft.color}
                          onChangeText={(color) => setGarmentEditDraft((current) => current ? { ...current, color } : current)}
                          placeholder="Ej. negro o #191919"
                          placeholderTextColor="#9B9386"
                          maxLength={60}
                        />
                      </View>

                      <Text style={styles.editorLabel}>COLOR SECUNDARIO <Text style={styles.editorOptional}>OPCIONAL</Text></Text>
                      <View style={styles.editorColorRow}>
                        <View style={[styles.editorColorSwatch, { backgroundColor: colorPreview(garmentEditDraft.secondaryColor) }]} />
                        <TextInput
                          style={[styles.editorInput, styles.editorColorInput]}
                          value={garmentEditDraft.secondaryColor}
                          onChangeText={(secondaryColor) => setGarmentEditDraft((current) => current ? { ...current, secondaryColor } : current)}
                          placeholder="Ej. blanco o #F5F1E8"
                          placeholderTextColor="#9B9386"
                          maxLength={60}
                        />
                      </View>

                      <Text style={styles.editorLabel}>ETIQUETAS</Text>
                      <TextInput
                        style={[styles.editorInput, styles.editorTagsInput]}
                        value={garmentEditDraft.tagsText}
                        onChangeText={(tagsText) => setGarmentEditDraft((current) => current ? { ...current, tagsText } : current)}
                        placeholder="casual, algodón, verano"
                        placeholderTextColor="#9B9386"
                        multiline
                        maxLength={380}
                      />
                      <Text style={styles.editorHelp}>Separa las etiquetas con comas. Máximo 12.</Text>

                      <View style={styles.editorActions}>
                        <Pressable style={styles.editorCancelButton} onPress={() => { setGarmentEditDraft(garmentDraftFor(selectedItem)); setEditingGarment(false); }} disabled={savingGarment}>
                          <Text style={styles.editorCancelText}>Cancelar</Text>
                        </Pressable>
                        <Pressable style={[styles.editorSaveButton, savingGarment && styles.disabledButton]} onPress={saveGarmentMetadata} disabled={savingGarment}>
                          {savingGarment ? <ActivityIndicator color={paper} /> : <Text style={styles.editorSaveText}>Guardar cambios</Text>}
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.detailHeadingRow}>
                        <View style={styles.detailHeadingCopy}>
                          <Text style={styles.eyebrow}>{selectedItem.type.toUpperCase()}</Text>
                          <Text style={styles.detailTitle}>{selectedItem.name}</Text>
                        </View>
                        <Pressable style={styles.editGarmentButton} onPress={() => setEditingGarment(true)} accessibilityLabel="Editar información de la prenda">
                          <Text style={styles.editGarmentButtonText}>Editar</Text>
                        </Pressable>
                      </View>
                      <View style={styles.garmentMetadataSummary}>
                        <View style={[styles.metadataColorDot, { backgroundColor: colorPreview(selectedItem.color) }]} />
                        <Text style={styles.metadataSummaryText}>{selectedItem.color}</Text>
                        {selectedItem.secondaryColor ? <><Text style={styles.metadataSeparator}>＋</Text><View style={[styles.metadataColorDot, { backgroundColor: colorPreview(selectedItem.secondaryColor) }]} /><Text style={styles.metadataSummaryText}>{selectedItem.secondaryColor}</Text></> : null}
                      </View>
                      {!!selectedItem.tags?.length && <View style={styles.metadataTags}>{selectedItem.tags.map((tag) => <View key={tag} style={styles.metadataTag}><Text style={styles.metadataTagText}>{tag}</Text></View>)}</View>}
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
                      <Pressable onPress={() => deleteGarment(selectedItem)} disabled={deletingGarmentId !== null}>
                        <Text style={[styles.deleteText, deletingGarmentId !== null && styles.disabledText]}>{deletingGarmentId === selectedItem.id ? "Eliminando prenda…" : "Eliminar de mi armario"}</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}
            </ScrollView>
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
                  <Pressable style={[styles.secondaryButton, styles.calendarDetailButton]} onPress={() => openCalendarForOutfit(selectedOutfit)}>
                    <Text style={styles.secondaryButtonText}>□ Agregar al calendario</Text>
                  </Pressable>
                  <Pressable style={styles.fullButton} onPress={() => trySavedOutfit(selectedOutfit)}>
                    <Text style={styles.fullButtonText}>Editar este outfit en el probador</Text>
                  </Pressable>
                  <Pressable onPress={() => deleteOutfit(selectedOutfit)} disabled={deletingOutfitId !== null}>
                    <Text style={[styles.deleteText, deletingOutfitId !== null && styles.disabledText]}>{deletingOutfitId === selectedOutfit.id ? "Eliminando Look…" : "Eliminar este Look"}</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={calendarPickerOpen} transparent animationType="slide" onRequestClose={() => setCalendarPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.calendarPickerSheet}>
            <Pressable style={styles.closeButton} onPress={() => setCalendarPickerOpen(false)}><Text style={styles.closeText}>×</Text></Pressable>
            <Text style={styles.eyebrow}>LOOKS GUARDADOS</Text>
            <Text style={styles.calendarPickerTitle}>¿Qué quieres usar?</Text>
            <Text style={styles.calendarPickerIntro}>Se agregará al {calendarDateLabel(calendarSelectedDate)} con un solo toque.</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.calendarPickerList}>
              {outfits.map((outfit) => (
                <Pressable key={outfit.id} style={[styles.calendarPickerCard, calendarSaving && styles.disabledButton]} onPress={() => saveCalendarEntry(calendarSelectedDate, outfit)} disabled={calendarSaving}>
                  <View style={styles.calendarPickerThumb}><OutfitVisual outfit={outfit} session={cloudSession} localPieceImages={localWardrobeImages} /></View>
                  <View style={styles.calendarPickerCopy}>
                    <Text style={styles.calendarAgendaEyebrow}>{outfit.occasion.toUpperCase()}</Text>
                    <Text style={styles.calendarAgendaName}>{outfit.name}</Text>
                    <Text style={styles.calendarAgendaMeta}>{outfit.pieces.length} prendas</Text>
                  </View>
                  <Text style={styles.calendarPickerArrow}>＋</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(schedulingOutfit)} transparent animationType="slide" onRequestClose={() => closeCalendarScheduler()}>
        <View style={styles.modalBackdrop}>
          <View style={styles.calendarScheduleSheet}>
            <Pressable style={styles.closeButton} onPress={() => closeCalendarScheduler()}><Text style={styles.closeText}>×</Text></Pressable>
            <Text style={styles.eyebrow}>PROGRAMAR LOOK</Text>
            <Text style={styles.calendarPickerTitle}>{schedulingOutfit?.name}</Text>
            <Text style={styles.calendarPickerIntro}>{calendarCustomDateOpen ? "Elige cualquier fecha." : "Toca un día y queda listo."}</Text>
            {calendarCustomDateOpen ? (
              <>
                <CalendarMonthGrid
                  month={calendarMonth}
                  selectedDate={calendarSelectedDate}
                  counts={calendarCounts}
                  onChangeMonth={changeCalendarMonth}
                  onSelectDate={setCalendarSelectedDate}
                />
                <Pressable style={[styles.fullButton, styles.calendarSaveButton, calendarSaving && styles.disabledButton]} onPress={() => saveCalendarEntry()} disabled={calendarSaving}>
                  {calendarSaving ? <ActivityIndicator color={paper} /> : <Text style={styles.fullButtonText}>Guardar para el {calendarDateLabel(calendarSelectedDate)}</Text>}
                </Pressable>
                <Pressable style={styles.calendarBackToQuick} onPress={() => setCalendarCustomDateOpen(false)}><Text style={styles.calendarBackToQuickText}>Ver fechas rápidas</Text></Pressable>
              </>
            ) : (
              <>
                <View style={styles.calendarQuickGrid}>
                  {quickCalendarDates.map((option) => (
                    <Pressable key={option.date} style={[styles.calendarQuickDate, calendarSaving && styles.disabledButton]} onPress={() => saveCalendarEntry(option.date)} disabled={calendarSaving}>
                      <Text style={styles.calendarQuickLabel}>{option.label}</Text>
                      <Text style={styles.calendarQuickDay}>{option.day}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={styles.secondaryButton} onPress={() => setCalendarCustomDateOpen(true)}><Text style={styles.secondaryButtonText}>Otra fecha</Text></Pressable>
              </>
            )}
            <Text style={styles.calendarSaveHint}>No consume otra generación y puedes cambiarlo después.</Text>
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
  homeHero: { overflow: "hidden", padding: 22, borderRadius: 24, backgroundColor: ink, marginBottom: 28 },
  homeTitle: { maxWidth: 310, color: paper, fontSize: 37, lineHeight: 40, letterSpacing: -1.4, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  homeIntro: { maxWidth: 290, color: "#C9C2B7", fontSize: 10, lineHeight: 16, marginTop: 10 },
  homePrimaryAction: { alignSelf: "flex-start", marginTop: 20, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22, backgroundColor: paper },
  homePrimaryActionText: { color: ink, fontSize: 9, fontWeight: "800" },
  homeSectionHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 3, marginBottom: 12 },
  homeSectionTitle: { color: ink, fontSize: 22, lineHeight: 25, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  homeSectionLink: { color: rust, fontSize: 8, fontWeight: "800", paddingVertical: 7 },
  homeTodayList: { gap: 8, marginBottom: 27 },
  homeTodayCard: { minHeight: 96, flexDirection: "row", alignItems: "center", overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 17, backgroundColor: "#F8F5ED" },
  homeTodayThumb: { width: 76, alignSelf: "stretch", backgroundColor: "#E9E2D5" },
  homeTodayCopy: { flex: 1, paddingHorizontal: 13, paddingVertical: 12 },
  homeTodayEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: 0.9 },
  homeTodayName: { color: ink, fontSize: 12, fontWeight: "800", marginTop: 5 },
  homeTodayMeta: { color: muted, fontSize: 7, marginTop: 5 },
  homeCardArrow: { color: muted, fontSize: 25, fontWeight: "300", paddingHorizontal: 14 },
  homeEmptyCalendar: { minHeight: 92, flexDirection: "row", alignItems: "center", paddingLeft: 15, marginBottom: 27, borderWidth: 1, borderColor: line, borderRadius: 17, backgroundColor: "#F8F5ED" },
  homeEmptyCalendarIcon: { width: 38, height: 38, color: rust, fontSize: 20, lineHeight: 36, textAlign: "center", borderRadius: 19, backgroundColor: "#F1E5DE" },
  homeEmptyCalendarCopy: { flex: 1, paddingHorizontal: 12 },
  homeEmptyCalendarTitle: { color: ink, fontSize: 11, fontWeight: "800" },
  homeEmptyCalendarMeta: { color: muted, fontSize: 7, lineHeight: 11, marginTop: 4 },
  homeLooksRail: { gap: 10, paddingRight: 16 },
  homeLookCard: { width: 128 },
  homeLookVisual: { width: 128, height: 158, overflow: "hidden", borderRadius: 15, backgroundColor: "#E9E2D5" },
  homeLookName: { color: ink, fontSize: 9, fontWeight: "700", marginTop: 8 },
  homeEmptyLooks: { alignItems: "center", padding: 28, borderWidth: 1, borderStyle: "dashed", borderColor: line, borderRadius: 18, backgroundColor: "#F8F5ED" },
  homeEmptyLooksTitle: { color: ink, fontSize: 15, fontWeight: "800" },
  homeEmptyLooksCopy: { maxWidth: 260, color: muted, fontSize: 8, lineHeight: 13, textAlign: "center", marginTop: 6 },
  profileHubHeader: { alignItems: "center", paddingTop: 4, paddingBottom: 24 },
  profileHubAvatar: { width: 86, height: 86, overflow: "hidden", alignItems: "center", justifyContent: "center", borderRadius: 43, borderWidth: 1, borderColor: line, backgroundColor: ink, marginBottom: 16 },
  profileHubAvatarImage: { width: "100%", height: "100%" },
  profileHubIntro: { maxWidth: 300, color: muted, fontSize: 9, lineHeight: 14, textAlign: "center", marginTop: 10 },
  profileLibrary: { overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 20, backgroundColor: "#F8F5ED" },
  profileLibraryRow: { minHeight: 78, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  profileLibraryIcon: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: paper },
  profileLibraryIconText: { color: ink, fontSize: 18 },
  profileLibraryCopy: { flex: 1, paddingHorizontal: 13 },
  profileLibraryTitle: { color: ink, fontSize: 12, fontWeight: "800" },
  profileLibraryMeta: { color: muted, fontSize: 7, marginTop: 4 },
  profileLibraryArrow: { color: muted, fontSize: 25, fontWeight: "300" },
  profileSettingsButton: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginTop: 13, borderWidth: 1, borderColor: line, borderRadius: 17 },
  profileSettingsText: { color: ink, fontSize: 9, fontWeight: "700" },
  wishlistEmpty: { alignItems: "center", marginTop: 12, paddingHorizontal: 26, paddingVertical: 48, borderWidth: 1, borderStyle: "dashed", borderColor: line, borderRadius: 20, backgroundColor: "#F8F5ED" },
  wishlistEmptyIcon: { color: rust, fontSize: 34, marginBottom: 14 },
  wishlistBrowseButton: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 20, backgroundColor: ink },
  wishlistBrowseButtonText: { color: paper, fontSize: 8, fontWeight: "800" },
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
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0, height: 78, paddingBottom: Platform.OS === "ios" ? 8 : 0, flexDirection: "row", justifyContent: "space-evenly", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line, backgroundColor: "#F8F5ED" },
  navItem: { width: 68, alignItems: "center", gap: 3 },
  navIcon: { color: muted, fontSize: 18 },
  navLabel: { color: muted, fontSize: 8 },
  navActive: { color: ink, fontWeight: "700" },
  navCreate: { width: 57, height: 57, marginTop: -24, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: ink, borderWidth: 4, borderColor: paper },
  navCreateIcon: { color: paper, fontSize: 24, lineHeight: 27, fontWeight: "300" },
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
  calendarPanel: { overflow: "hidden", padding: 10, borderWidth: 1, borderColor: line, borderRadius: 20, backgroundColor: "#F8F5ED" },
  calendarMonthHeader: { height: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  calendarMonthTitle: { color: ink, fontSize: 15, fontWeight: "800", fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  calendarArrow: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, borderWidth: 1, borderColor: line, backgroundColor: paper },
  calendarArrowText: { color: ink, fontSize: 27, lineHeight: 29, fontWeight: "300" },
  calendarWeekRow: { flexDirection: "row", marginTop: 6, marginBottom: 3 },
  calendarWeekday: { width: "14.285%", color: muted, textAlign: "center", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  calendarDaysGrid: { flexDirection: "row", flexWrap: "wrap" },
  calendarDayCell: { width: "14.285%", height: 43, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  calendarDayCellSelected: { backgroundColor: ink },
  calendarDayText: { color: ink, fontSize: 10, fontWeight: "600" },
  calendarDayTextSelected: { color: paper, fontWeight: "900" },
  calendarDayToday: { color: rust, textDecorationLine: "underline", fontWeight: "900" },
  calendarDot: { position: "absolute", bottom: 4, minWidth: 5, height: 5, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: rust },
  calendarDotSelected: { minWidth: 11, height: 11, bottom: 2, backgroundColor: paper },
  calendarDotText: { color: ink, fontSize: 6, fontWeight: "900" },
  calendarAgendaHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 24, marginBottom: 12 },
  calendarSelectedTitle: { color: ink, fontSize: 22, lineHeight: 25, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  calendarAgendaCount: { color: muted, fontSize: 8, fontWeight: "700", paddingBottom: 3 },
  calendarAgendaList: { gap: 9 },
  calendarAgendaCard: { position: "relative", flexDirection: "row", overflow: "hidden", minHeight: 104, borderWidth: 1, borderColor: line, borderRadius: 16, backgroundColor: "#F8F5ED" },
  calendarAgendaOpen: { flex: 1, flexDirection: "row", alignItems: "center" },
  calendarAgendaThumb: { width: 74, alignSelf: "stretch", backgroundColor: "#E9E2D5" },
  calendarAgendaCopy: { flex: 1, paddingHorizontal: 13, paddingVertical: 12, paddingRight: 35 },
  calendarAgendaEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: 0.8 },
  calendarAgendaName: { color: ink, fontSize: 12, lineHeight: 16, fontWeight: "800", marginTop: 5 },
  calendarAgendaMeta: { color: muted, fontSize: 7, marginTop: 6 },
  calendarAgendaRemove: { position: "absolute", right: 8, top: 8, width: 27, height: 27, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: paper },
  calendarAgendaRemoveText: { color: rust, fontSize: 20, lineHeight: 21, fontWeight: "300" },
  calendarEmpty: { minHeight: 150, alignItems: "center", justifyContent: "center", padding: 24, borderWidth: 1, borderStyle: "dashed", borderColor: line, borderRadius: 18, backgroundColor: "#F8F5ED" },
  calendarEmptyIcon: { color: rust, fontSize: 24, fontWeight: "300" },
  calendarEmptyTitle: { color: ink, fontSize: 14, fontWeight: "800", marginTop: 9 },
  calendarEmptyCopy: { color: muted, maxWidth: 240, fontSize: 8, lineHeight: 13, textAlign: "center", marginTop: 6 },
  calendarDetailButton: { marginBottom: 8 },
  calendarPickerSheet: { maxHeight: "90%", paddingHorizontal: 20, paddingTop: 38, paddingBottom: 24, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  calendarScheduleSheet: { paddingHorizontal: 20, paddingTop: 38, paddingBottom: 26, backgroundColor: paper, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  calendarPickerTitle: { color: ink, fontSize: 31, lineHeight: 34, letterSpacing: -1, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  calendarPickerIntro: { color: muted, fontSize: 9, lineHeight: 14, marginTop: 8, marginBottom: 16 },
  calendarPickerList: { gap: 8, paddingBottom: 10 },
  calendarPickerCard: { minHeight: 95, flexDirection: "row", alignItems: "center", overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 15, backgroundColor: "#F8F5ED" },
  calendarPickerThumb: { width: 68, alignSelf: "stretch", backgroundColor: "#E9E2D5" },
  calendarPickerCopy: { flex: 1, paddingHorizontal: 12, paddingVertical: 10 },
  calendarPickerArrow: { color: rust, fontSize: 26, fontWeight: "300", paddingHorizontal: 12 },
  calendarSaveButton: { marginTop: 14, backgroundColor: rust },
  calendarSaveHint: { color: muted, fontSize: 7, lineHeight: 11, textAlign: "center", marginTop: 10 },
  calendarQuickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  calendarQuickDate: { width: "22.5%", minHeight: 72, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: line, borderRadius: 15, backgroundColor: "#F8F5ED" },
  calendarQuickLabel: { color: muted, fontSize: 7, fontWeight: "800", textTransform: "uppercase" },
  calendarQuickDay: { color: ink, fontSize: 22, lineHeight: 27, fontWeight: "700", marginTop: 3, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  calendarBackToQuick: { alignItems: "center", paddingVertical: 12 },
  calendarBackToQuickText: { color: rust, fontSize: 8, fontWeight: "800" },
  outfitPieceList: { marginTop: 12, marginBottom: 14, padding: 12, gap: 5, borderWidth: 1, borderColor: line, borderRadius: 12, backgroundColor: "#F8F5ED" },
  outfitPieceName: { color: ink, fontSize: 9, lineHeight: 14 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.45)" },
  createMenuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(22,20,17,.42)" },
  createMenuSheet: { paddingHorizontal: 20, paddingTop: 11, paddingBottom: Platform.OS === "ios" ? 34 : 24, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: paper },
  createMenuHandle: { width: 38, height: 4, alignSelf: "center", borderRadius: 2, backgroundColor: line, marginBottom: 24 },
  createMenuEyebrow: { color: rust, fontSize: 7, fontWeight: "900", letterSpacing: 1.3 },
  createMenuTitle: { color: ink, fontSize: 35, lineHeight: 39, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), marginTop: 4, marginBottom: 18 },
  createMenuAction: { minHeight: 82, flexDirection: "row", alignItems: "center", paddingHorizontal: 13, marginBottom: 9, borderWidth: 1, borderColor: line, borderRadius: 18, backgroundColor: "#F8F5ED" },
  createMenuActionIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: ink },
  createMenuActionIconText: { color: paper, fontSize: 20, fontWeight: "300" },
  createMenuActionCopy: { flex: 1, paddingHorizontal: 13 },
  createMenuActionTitle: { color: ink, fontSize: 12, fontWeight: "800" },
  createMenuActionMeta: { color: muted, fontSize: 7, lineHeight: 11, marginTop: 4 },
  createMenuActionArrow: { color: muted, fontSize: 25, fontWeight: "300" },
  createMenuCancel: { alignItems: "center", paddingVertical: 13, marginTop: 2 },
  createMenuCancelText: { color: muted, fontSize: 9, fontWeight: "700" },
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
  premiumCard: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 18, padding: 13, borderWidth: 1, borderColor: "#D5B8AA", borderRadius: 15, backgroundColor: "#F5E9E2" },
  premiumCardIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: ink },
  premiumCardIconText: { color: paper, fontSize: 8, fontWeight: "900", letterSpacing: .5 },
  premiumCardCopy: { flex: 1 },
  premiumCardEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: .9 },
  premiumCardTitle: { color: ink, fontSize: 10, fontWeight: "800", marginTop: 4 },
  premiumCardArrow: { color: rust, fontSize: 25, fontWeight: "300" },
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
  detailHeadingRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  detailHeadingCopy: { flex: 1 },
  detailTitle: { color: ink, fontSize: 34, lineHeight: 37, letterSpacing: -1.2, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  detailIntro: { color: muted, fontSize: 10, lineHeight: 16, marginTop: 12, marginBottom: 20 },
  editGarmentButton: { marginTop: 3, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: line, backgroundColor: "#F8F5ED" },
  editGarmentButtonText: { color: rust, fontSize: 8, fontWeight: "900", letterSpacing: 0.4 },
  garmentMetadataSummary: { minHeight: 24, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 13 },
  metadataColorDot: { width: 15, height: 15, borderRadius: 8, borderWidth: 1, borderColor: "rgba(25,24,21,.16)" },
  metadataSummaryText: { color: muted, fontSize: 8, fontWeight: "700" },
  metadataSeparator: { color: "#A79F92", fontSize: 9 },
  metadataTags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 9 },
  metadataTag: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: "#E9E2D5" },
  metadataTagText: { color: ink, fontSize: 7, fontWeight: "700" },
  garmentEditor: { paddingTop: 3 },
  editorIntro: { color: muted, fontSize: 9, lineHeight: 14, marginTop: 9, marginBottom: 19 },
  editorLabel: { color: ink, fontSize: 7, fontWeight: "900", letterSpacing: 1, marginTop: 14, marginBottom: 7 },
  editorOptional: { color: muted, fontSize: 6, fontWeight: "700", letterSpacing: 0.5 },
  editorInput: { minHeight: 46, paddingHorizontal: 13, paddingVertical: 11, borderWidth: 1, borderColor: line, borderRadius: 13, backgroundColor: "#F8F5ED", color: ink, fontSize: 11 },
  editorCategoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  editorCategory: { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: line, borderRadius: 17, backgroundColor: "#F8F5ED" },
  editorCategoryActive: { borderColor: ink, backgroundColor: ink },
  editorCategoryText: { color: muted, fontSize: 8, fontWeight: "700" },
  editorCategoryTextActive: { color: paper },
  editorColorRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  editorColorSwatch: { width: 46, height: 46, borderRadius: 13, borderWidth: 1, borderColor: "rgba(25,24,21,.16)" },
  editorColorInput: { flex: 1 },
  editorTagsInput: { minHeight: 72, textAlignVertical: "top" },
  editorHelp: { color: muted, fontSize: 7, marginTop: 6 },
  editorActions: { flexDirection: "row", gap: 9, marginTop: 22 },
  editorCancelButton: { flex: 1, minHeight: 47, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: line, borderRadius: 24, backgroundColor: "#F8F5ED" },
  editorCancelText: { color: ink, fontSize: 9, fontWeight: "800" },
  editorSaveButton: { flex: 1.5, minHeight: 47, alignItems: "center", justifyContent: "center", borderRadius: 24, backgroundColor: rust },
  editorSaveText: { color: paper, fontSize: 9, fontWeight: "900" },
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

function categoryForUi(category: string): Exclude<Category, "all"> {
  if (category === "tops" || category === "layers" || category === "bottoms" || category === "footwear" || category === "accessories" || category === "one_piece") return category;
  return "accessories";
}

function garmentDraftFor(item: WardrobeItem): GarmentEditDraft {
  return {
    name: item.name,
    category: item.category,
    color: item.color === "Sin confirmar" ? "" : item.color,
    secondaryColor: item.secondaryColor || "",
    tagsText: (item.tags || []).join(", "),
  };
}

function colorPreview(value: string) {
  const normalized = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/iu.test(normalized)) return normalized;
  const colors: Record<string, string> = {
    negro: "#191919", black: "#191919", blanco: "#f5f1e8", white: "#f5f1e8",
    gris: "#88857f", gray: "#88857f", grey: "#88857f", rojo: "#b63f32", red: "#b63f32",
    azul: "#315b86", blue: "#315b86", verde: "#547052", green: "#547052",
    amarillo: "#d6aa3d", yellow: "#d6aa3d", naranja: "#c96b31", orange: "#c96b31",
    rosa: "#cf8795", pink: "#cf8795", morado: "#70547f", purple: "#70547f",
    beige: "#c9b99d", café: "#765443", cafe: "#765443", brown: "#765443",
    camel: "#a97a48", oliva: "#6f7045", olive: "#6f7045", crema: "#e7ddc7", cream: "#e7ddc7",
  };
  return colors[normalized] || "#d8d1c4";
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
