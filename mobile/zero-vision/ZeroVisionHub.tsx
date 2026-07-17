import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type GestureResponderEvent,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { cloudFetch } from "../cortex/cloud";
import type { CloudSession } from "../cortex/types";

type Tab = "garment" | "avatar";
type Mode = "plain" | "rectangle";
type Rect = { x: number; y: number; width: number; height: number };

type Props = {
  visible: boolean;
  initialTab?: Tab;
  session: CloudSession;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onPaidAvatar: () => void;
};

type Asset = ImagePicker.ImagePickerAsset;

type ApiState = {
  tone: "success" | "error" | "info";
  title: string;
  message?: string;
} | null;

const categoryOptions = [
  { id: "tops", label: "Top" },
  { id: "layers", label: "Capa" },
  { id: "bottoms", label: "Parte inferior" },
  { id: "one_piece", label: "Vestido" },
  { id: "footwear", label: "Calzado" },
  { id: "accessories", label: "Accesorio" },
] as const;

export default function ZeroVisionHub({ visible, initialTab = "garment", session, onClose, onChanged, onPaidAvatar }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<Mode>("plain");
  const [garmentPhoto, setGarmentPhoto] = useState<Asset | null>(null);
  const [avatarPhoto, setAvatarPhoto] = useState<Asset | null>(null);
  const [category, setCategory] = useState<(typeof categoryOptions)[number]["id"]>("tops");
  const [name, setName] = useState("");
  const [rect, setRect] = useState<Rect>({ x: 0.1, y: 0.08, width: 0.8, height: 0.84 });
  const [working, setWorking] = useState(false);
  const [state, setState] = useState<ApiState>(null);

  const pick = async (kind: Tab) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setState({ tone: "error", title: "Permiso necesario", message: "Activa Fotos para elegir una imagen." });
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
    if (kind === "garment") {
      setGarmentPhoto(result.assets[0]);
      setRect({ x: 0.1, y: 0.08, width: 0.8, height: 0.84 });
    } else setAvatarPhoto(result.assets[0]);
    setState(null);
  };

  const scanGarment = async () => {
    if (!garmentPhoto || working) return;
    setWorking(true);
    setState({ tone: "info", title: "Separando la prenda", message: "Estamos limpiando el fondo y revisando los bordes." });
    let temporaryUri: string | null = null;
    try {
      const resized = await ImageManipulator.manipulateAsync(
        garmentPhoto.uri,
        garmentPhoto.width > 1200 ? [{ resize: { width: 1200 } }] : [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      temporaryUri = resized.uri;
      const form = new FormData();
      form.append("image", { uri: resized.uri, name: "garment.jpg", type: "image/jpeg" } as unknown as Blob);
      form.append("mode", mode);
      form.append("category", category);
      if (name.trim()) form.append("name", name.trim());
      if (mode === "rectangle") form.append("rect", JSON.stringify(rect));
      const response = await cloudFetch(session, "/api/v1/garments/zero-cost", { method: "POST", body: form });
      const payload = await response.json() as {
        error?: string;
        guidance?: string;
        duplicate?: boolean;
        garment?: { name?: string };
        metrics?: { score?: number };
      };
      if (!response.ok) {
        setState({
          tone: "error",
          title: payload.error === "zero_vision_quality_low" ? "La máscara necesita otra toma" : "No pudimos separar la prenda",
          message: payload.guidance || garmentError(payload.error),
        });
        return;
      }
      setState({
        tone: "success",
        title: payload.duplicate ? "Ya estaba en tu armario" : "Prenda lista",
        message: payload.duplicate ? "Vesta evitó guardar un duplicado." : `${payload.garment?.name || "La prenda"} quedó guardada en tu armario.`,
      });
      if (mode === "plain") setGarmentPhoto(null);
      else setRect({ x: 0.1, y: 0.08, width: 0.8, height: 0.84 });
      setName("");
      await Promise.resolve(onChanged()).catch(() => undefined);
    } catch {
      setState({ tone: "error", title: "Escaneo interrumpido", message: "La foto sigue intacta. Comprueba la conexión e inténtalo de nuevo." });
    } finally {
      setWorking(false);
      if (temporaryUri?.startsWith("file:")) await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    }
  };

  const createPhotoAvatar = async () => {
    if (!avatarPhoto || working) return;
    setWorking(true);
    setState({ tone: "info", title: "Preparando tu avatar", message: "Estamos revisando el encuadre y limpiando el fondo." });
    let temporaryUri: string | null = null;
    try {
      const resized = await ImageManipulator.manipulateAsync(
        avatarPhoto.uri,
        avatarPhoto.width > 1200 ? [{ resize: { width: 1200 } }] : [],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      temporaryUri = resized.uri;
      const form = new FormData();
      form.append("image", { uri: resized.uri, name: "full-body.jpg", type: "image/jpeg" } as unknown as Blob);
      const response = await cloudFetch(session, "/api/v1/avatar/zero-cost", { method: "POST", body: form });
      const payload = await response.json() as { error?: string; guidance?: string; score?: number };
      if (!response.ok) {
        setState({
          tone: "error",
          title: "La foto no cumple todavía",
          message: payload.guidance || avatarError(payload.error),
        });
        return;
      }
      setState({
        tone: "success",
        title: "Tu avatar está listo",
        message: "Vesta conservó tu apariencia y preparó la foto para probar tus looks.",
      });
      setAvatarPhoto(null);
      await Promise.resolve(onChanged()).catch(() => undefined);
    } catch {
      setState({ tone: "error", title: "No pudimos guardar el avatar", message: "Comprueba la conexión e inténtalo otra vez." });
    } finally {
      setWorking(false);
      if (temporaryUri?.startsWith("file:")) await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>CAPTURA GUIADA</Text>
            <Text style={styles.headerTitle}>Añadir a Vesta</Text>
          </View>
          <Pressable style={styles.close} onPress={onClose} accessibilityLabel="Cerrar Zero Vision"><Text style={styles.closeText}>×</Text></Pressable>
        </View>
        <View style={styles.tabs}>
          <Pressable style={[styles.tab, tab === "garment" && styles.tabActive]} onPress={() => { setTab("garment"); setState(null); }}><Text style={[styles.tabText, tab === "garment" && styles.tabTextActive]}>ESCANEAR PRENDA</Text></Pressable>
          <Pressable style={[styles.tab, tab === "avatar" && styles.tabActive]} onPress={() => { setTab("avatar"); setState(null); }}><Text style={[styles.tabText, tab === "avatar" && styles.tabTextActive]}>AVATAR FOTOGRÁFICO</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {state ? <View style={[styles.state, state.tone === "success" && styles.stateSuccess, state.tone === "error" && styles.stateError]}><Text style={styles.stateTitle}>{state.title}</Text>{state.message ? <Text style={styles.stateMessage}>{state.message}</Text> : null}</View> : null}
          {tab === "garment" ? (
            <>
              <Text style={styles.title}>Una prenda. Una foto.</Text>
              <Text style={styles.intro}>Obtendrás mejores resultados sobre un fondo liso. Si usas una foto normal, solo encierra la prenda que quieres guardar.</Text>
              <View style={styles.modeRow}>
                <Pressable style={[styles.mode, mode === "plain" && styles.modeActive]} onPress={() => setMode("plain")}><Text style={[styles.modeTitle, mode === "plain" && styles.modeTitleActive]}>FONDO LISO</Text><Text style={styles.modeCopy}>Resultado más preciso</Text></Pressable>
                <Pressable style={[styles.mode, mode === "rectangle" && styles.modeActive]} onPress={() => setMode("rectangle")}><Text style={[styles.modeTitle, mode === "rectangle" && styles.modeTitleActive]}>FOTO NORMAL</Text><Text style={styles.modeCopy}>Dibuja el área</Text></Pressable>
              </View>
              <View style={styles.guide}>
                <GuideStep number="1" text={mode === "plain" ? "Pon una sola prenda sobre un fondo liso que contraste." : "Elige una foto y encierra únicamente la prenda."} />
                <GuideStep number="2" text="Deja visible toda la silueta; evita manos, perchas cruzadas y sombras duras." />
                <GuideStep number="3" text="Vesta mide la calidad y rechaza el resultado antes de guardar si no es confiable." />
              </View>
              <View style={styles.categories}>{categoryOptions.map((option) => <Pressable key={option.id} style={[styles.category, category === option.id && styles.categoryActive]} onPress={() => setCategory(option.id)}><Text style={[styles.categoryText, category === option.id && styles.categoryTextActive]}>{option.label}</Text></Pressable>)}</View>
              <TextInput value={name} onChangeText={setName} placeholder="Nombre opcional · ej. Camisa azul" placeholderTextColor="#8A8A8A" style={styles.input} />
              {garmentPhoto ? (
                <>
                  {mode === "rectangle" ? <RectangleEditor asset={garmentPhoto} value={rect} onChange={setRect} /> : <Image source={{ uri: garmentPhoto.uri }} resizeMode="contain" style={styles.photoPreview} />}
                  <Pressable style={styles.changePhoto} onPress={() => pick("garment")}><Text style={styles.changePhotoText}>CAMBIAR FOTO</Text></Pressable>
                </>
              ) : <Pressable style={styles.picker} onPress={() => pick("garment")}><Text style={styles.pickerMark}>＋</Text><Text style={styles.pickerTitle}>Elegir foto de una prenda</Text><Text style={styles.pickerCopy}>JPG o PNG · se normaliza antes de subir</Text></Pressable>}
              <Pressable style={[styles.primary, (!garmentPhoto || working) && styles.disabled]} disabled={!garmentPhoto || working} onPress={scanGarment}>{working ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>GUARDAR PRENDA</Text>}</Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Tu foto real puede ser el avatar.</Text>
              <Text style={styles.intro}>Usa una foto clara de cuerpo completo. Vesta conservará tu apariencia, limpiará el fondo y preparará la imagen para tus looks.</Text>
              <View style={styles.avatarGuide}>
                <Text style={styles.avatarGuideTitle}>CAPTURA CANÓNICA</Text>
                <Text style={styles.avatarGuideLine}>• cuerpo completo, cabeza y ambos pies visibles</Text>
                <Text style={styles.avatarGuideLine}>• de frente, brazos separados ligeramente</Text>
                <Text style={styles.avatarGuideLine}>• ropa ajustada y neutra</Text>
                <Text style={styles.avatarGuideLine}>• pared lisa que contraste, sin espejo ni muebles</Text>
              </View>
              {avatarPhoto ? <><Image source={{ uri: avatarPhoto.uri }} resizeMode="contain" style={styles.avatarPreview} /><Pressable style={styles.changePhoto} onPress={() => pick("avatar")}><Text style={styles.changePhotoText}>CAMBIAR FOTO</Text></Pressable></> : <Pressable style={styles.picker} onPress={() => pick("avatar")}><Text style={styles.pickerMark}>◇</Text><Text style={styles.pickerTitle}>Elegir foto de cuerpo completo</Text><Text style={styles.pickerCopy}>Tu foto se mantiene privada y conserva tu apariencia real</Text></Pressable>}
              <Pressable style={[styles.primary, (!avatarPhoto || working) && styles.disabled]} disabled={!avatarPhoto || working} onPress={createPhotoAvatar}>{working ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>PREPARAR MI AVATAR</Text>}</Pressable>
              <Pressable style={styles.fallback} onPress={onPaidAvatar}><Text style={styles.fallbackTitle}>¿No tienes una foto adecuada?</Text><Text style={styles.fallbackCopy}>Crear el avatar de otra forma</Text></Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function RectangleEditor({ asset, value, onChange }: { asset: Asset; value: Rect; onChange: (rect: Rect) => void }) {
  const window = useWindowDimensions();
  const ratio = Math.max(0.2, Math.min(5, asset.width / asset.height));
  let width = window.width - 32;
  let height = width / ratio;
  if (height > 430) {
    height = 430;
    width = height * ratio;
  }
  const start = useRef<{ x: number; y: number } | null>(null);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: GestureResponderEvent) => {
      start.current = { x: clamp(event.nativeEvent.locationX / width), y: clamp(event.nativeEvent.locationY / height) };
    },
    onPanResponderMove: (event: GestureResponderEvent) => {
      if (!start.current) return;
      const current = { x: clamp(event.nativeEvent.locationX / width), y: clamp(event.nativeEvent.locationY / height) };
      const x = Math.min(start.current.x, current.x);
      const y = Math.min(start.current.y, current.y);
      onChange({ x, y, width: Math.max(0.03, Math.abs(current.x - start.current.x)), height: Math.max(0.03, Math.abs(current.y - start.current.y)) });
    },
    onPanResponderRelease: () => { start.current = null; },
    onPanResponderTerminate: () => { start.current = null; },
  }), [width, height, onChange]);
  return <View style={[styles.editorWrap, { width, height }]} {...pan.panHandlers}><Image source={{ uri: asset.uri }} resizeMode="stretch" style={StyleSheet.absoluteFill} /><View pointerEvents="none" style={[styles.selection, { left: value.x * width, top: value.y * height, width: value.width * width, height: value.height * height }]}><View style={styles.selectionLabel}><Text style={styles.selectionLabelText}>PRENDA</Text></View></View><Text pointerEvents="none" style={styles.editorHint}>ARRASTRA PARA DIBUJAR EL RECTÁNGULO</Text></View>;
}

function GuideStep({ number, text }: { number: string; text: string }) {
  return <View style={styles.guideStep}><View style={styles.guideNumber}><Text style={styles.guideNumberText}>{number}</Text></View><Text style={styles.guideText}>{text}</Text></View>;
}

function garmentError(code?: string) {
  if (code === "subscription_required") return "Mejora tu plan para añadir más prendas al armario.";
  if (code === "zero_vision_image_invalid") return "Usa una imagen JPG o PNG de hasta 12 MB.";
  return "Usa una sola prenda completa y un fondo con mayor contraste.";
}

function avatarError(code?: string) {
  if (code === "zero_cost_avatar_image_invalid") return "Usa una imagen JPG o PNG de cuerpo completo.";
  return "Repite la captura con más margen y un fondo liso contrastante.";
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

const ink = "#121416";
const blue = "#3157E8";
const line = "#DEE2EA";
const muted = "#687080";
const paper = "#F7F8FB";

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: paper },
  header: { minHeight: 82, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: Platform.OS === "ios" ? 8 : 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line, backgroundColor: "#FFFFFF" },
  kicker: { color: blue, fontSize: 7, fontWeight: "900", letterSpacing: 1.5 },
  headerTitle: { color: ink, fontSize: 22, fontWeight: "900", letterSpacing: -0.7, marginTop: 4 },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "#EEF1F6" },
  closeText: { color: ink, fontSize: 27, lineHeight: 29, fontWeight: "300" },
  tabs: { height: 54, flexDirection: "row", backgroundColor: "#FFFFFF", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: line },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: blue },
  tabText: { color: muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  tabTextActive: { color: ink },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: ink, fontSize: 32, lineHeight: 35, letterSpacing: -1.2, fontWeight: "900" },
  intro: { color: muted, fontSize: 11, lineHeight: 17, marginTop: 10, marginBottom: 18 },
  state: { padding: 13, borderRadius: 14, borderWidth: 1, borderColor: "#CCD6F5", backgroundColor: "#EEF2FF", marginBottom: 16 },
  stateSuccess: { borderColor: "#B9D7C1", backgroundColor: "#EDF8F0" },
  stateError: { borderColor: "#E4C2BC", backgroundColor: "#FFF1EF" },
  stateTitle: { color: ink, fontSize: 11, fontWeight: "900" },
  stateMessage: { color: muted, fontSize: 8, lineHeight: 13, marginTop: 4 },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 15 },
  mode: { flex: 1, minHeight: 72, justifyContent: "center", paddingHorizontal: 12, borderWidth: 1, borderColor: line, borderRadius: 16, backgroundColor: "#FFFFFF" },
  modeActive: { borderColor: blue, backgroundColor: "#EEF2FF" },
  modeTitle: { color: muted, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  modeTitleActive: { color: blue },
  modeCopy: { color: muted, fontSize: 7, marginTop: 5 },
  guide: { gap: 9, padding: 13, borderRadius: 16, backgroundColor: "#111827", marginBottom: 15 },
  guideStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  guideNumber: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: blue },
  guideNumberText: { color: "#FFF", fontSize: 8, fontWeight: "900" },
  guideText: { flex: 1, color: "#E5E7EB", fontSize: 8, lineHeight: 12 },
  categories: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 11 },
  category: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 16, borderWidth: 1, borderColor: line, backgroundColor: "#FFF" },
  categoryActive: { borderColor: ink, backgroundColor: ink },
  categoryText: { color: muted, fontSize: 8, fontWeight: "700" },
  categoryTextActive: { color: "#FFF" },
  input: { minHeight: 50, paddingHorizontal: 14, borderWidth: 1, borderColor: line, borderRadius: 14, backgroundColor: "#FFF", color: ink, fontSize: 10, marginBottom: 12 },
  picker: { minHeight: 168, alignItems: "center", justifyContent: "center", padding: 22, borderWidth: 1, borderStyle: "dashed", borderColor: "#AEB8CB", borderRadius: 20, backgroundColor: "#FFFFFF" },
  pickerMark: { color: blue, fontSize: 30, fontWeight: "300" },
  pickerTitle: { color: ink, fontSize: 12, fontWeight: "900", marginTop: 8 },
  pickerCopy: { color: muted, fontSize: 8, textAlign: "center", marginTop: 5 },
  photoPreview: { width: "100%", height: 330, borderRadius: 20, backgroundColor: "#E9ECF2" },
  avatarPreview: { width: "100%", height: 430, borderRadius: 20, backgroundColor: "#E9ECF2" },
  changePhoto: { alignItems: "center", paddingVertical: 12 },
  changePhotoText: { color: blue, fontSize: 8, fontWeight: "900", letterSpacing: 0.8 },
  primary: { minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: blue, marginTop: 14 },
  primaryText: { color: "#FFF", fontSize: 9, fontWeight: "900", letterSpacing: 0.55 },
  disabled: { opacity: 0.45 },
  editorWrap: { alignSelf: "center", overflow: "hidden", borderRadius: 18, backgroundColor: "#E9ECF2" },
  selection: { position: "absolute", borderWidth: 2, borderColor: "#7CFFB2", backgroundColor: "rgba(49,87,232,.10)" },
  selectionLabel: { position: "absolute", left: 6, top: 6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, backgroundColor: "#0F172A" },
  selectionLabelText: { color: "#FFF", fontSize: 6, fontWeight: "900", letterSpacing: 0.7 },
  editorHint: { position: "absolute", left: 0, right: 0, bottom: 8, color: "#FFF", fontSize: 6, fontWeight: "900", letterSpacing: 0.7, textAlign: "center", textShadowColor: "rgba(0,0,0,.7)", textShadowRadius: 4 },
  avatarGuide: { padding: 16, borderRadius: 18, backgroundColor: "#111827", marginBottom: 14 },
  avatarGuideTitle: { color: "#7CFFB2", fontSize: 7, fontWeight: "900", letterSpacing: 1.1, marginBottom: 9 },
  avatarGuideLine: { color: "#E5E7EB", fontSize: 9, lineHeight: 16 },
  fallback: { alignItems: "center", padding: 15, marginTop: 10 },
  fallbackTitle: { color: ink, fontSize: 9, fontWeight: "800" },
  fallbackCopy: { color: muted, fontSize: 7, marginTop: 3 },
});
