import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ImageSourcePropType } from "react-native";
import type {
  ClosetPulse,
  NativeGarment,
  StudioDirection,
  StylistBrief,
  StylistMood,
  StylistWeather,
} from "./intelligence";

const ink = "#0E0E0E";
const paper = "#FFFFFF";
const rust = "#A34F31";
const line = "#E7E5E1";
const muted = "#77736D";
const soft = "#F4F2EE";

const serif = Platform.select({ ios: "Georgia", android: "serif" });

export function VestaTodayHero({
  visual,
  avatarSource,
  outfit,
  pulse,
  onOpenLook,
  onStudio,
  onStylist,
}: {
  visual?: ReactNode;
  avatarSource?: ImageSourcePropType | null;
  outfit?: { name: string; occasion: string; isReal: boolean } | null;
  pulse: ClosetPulse;
  onOpenLook: () => void;
  onStudio: () => void;
  onStylist: () => void;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(entrance, {
      toValue: 1,
      damping: 18,
      stiffness: 150,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [entrance, outfit?.name]);

  return (
    <Animated.View
      style={[
        styles.todayHero,
        {
          opacity: entrance,
          transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        },
      ]}
    >
      <View style={styles.todayVisual}>
        {visual || (avatarSource ? <Image source={avatarSource} resizeMode="contain" style={styles.todayAvatar} /> : (
          <View style={styles.todayBlank}>
            <Text style={styles.todayBlankMark}>V</Text>
            <Text style={styles.todayBlankText}>TU AVATAR SERÁ EL CENTRO DE VESTA</Text>
          </View>
        ))}
        <View pointerEvents="none" style={styles.todayTopShade} />
        <View pointerEvents="none" style={styles.todayBottomShade} />
        <View style={styles.todayTopRow}>
          <View style={styles.todayBadge}><View style={styles.liveDot} /><Text style={styles.todayBadgeText}>VESTA TODAY</Text></View>
          <Text style={styles.todayTopMeta}>{outfit?.isReal ? "RENDER AI REAL" : outfit ? "LISTO PARA RENDER" : avatarSource ? "AVATAR LISTO" : "CONFIGURACIÓN"}</Text>
        </View>
        <View style={styles.todayCopy}>
          <Text style={styles.todayEyebrow}>{outfit ? outfit.occasion.toUpperCase() : pulse.styleName.toUpperCase()}</Text>
          <Text style={styles.todayTitle}>{outfit?.name || "Tu mejor look todavía está en tu armario."}</Text>
          <Text style={styles.todaySubtitle}>{outfit
            ? "Vesta ya tiene una versión completa para hoy. Ábrela, edítala o úsala como punto de partida."
            : "Dirige la intención y Vesta construirá el outfit antes de llevarlo a tu avatar."}</Text>
          <View style={styles.todayActions}>
            <Pressable style={styles.todayPrimary} onPress={outfit ? onOpenLook : onStylist}>
              <Text style={styles.todayPrimaryText}>{outfit ? "Abrir look" : "Dirigir mi primer look"}</Text>
            </Pressable>
            <Pressable style={styles.todaySecondary} onPress={onStudio}>
              <Text style={styles.todaySecondaryText}>Studio</Text><Text style={styles.todaySecondaryArrow}>↗</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <View style={styles.pulseRail}>
        <PulseMetric value={pulse.readyGarments} label="PRENDAS LISTAS" />
        <View style={styles.metricDivider} />
        <PulseMetric value={pulse.realLooks} label="LOOKS REALES" />
        <View style={styles.metricDivider} />
        <PulseMetric value={pulse.outfitPotential >= 999 ? "999+" : pulse.outfitPotential} label="POSIBILIDADES" />
      </View>
    </Animated.View>
  );
}

function PulseMetric({ value, label }: { value: number | string; label: string }) {
  return (
    <View style={styles.pulseMetric}>
      <Text style={styles.pulseValue}>{value}</Text>
      <Text style={styles.pulseLabel}>{label}</Text>
    </View>
  );
}

export function ClosetIntelligencePanel({
  pulse,
  onOpenCloset,
  onOpenStylist,
}: {
  pulse: ClosetPulse;
  onOpenCloset: () => void;
  onOpenStylist: () => void;
}) {
  return (
    <View style={styles.intelligencePanel}>
      <View style={styles.intelligenceHeader}>
        <View>
          <Text style={styles.microEyebrow}>STYLE DNA</Text>
          <Text style={styles.intelligenceTitle}>{pulse.styleName}</Text>
        </View>
        <View style={styles.coveragePill}><Text style={styles.coverageValue}>{pulse.coverageScore}%</Text><Text style={styles.coverageLabel}>COBERTURA</Text></View>
      </View>
      <View style={styles.paletteRow}>
        <Text style={styles.paletteLabel}>PALETA DOMINANTE</Text>
        <Text style={styles.paletteValue}>{pulse.dominantPalette}</Text>
      </View>
      <Text style={styles.nextMove}>{pulse.nextMove}</Text>
      <View style={styles.intelligenceActions}>
        <Pressable style={styles.intelligencePrimary} onPress={onOpenStylist}><Text style={styles.intelligencePrimaryText}>Crear con intención　✦</Text></Pressable>
        <Pressable style={styles.intelligenceQuiet} onPress={onOpenCloset}><Text style={styles.intelligenceQuietText}>Ver armario</Text></Pressable>
      </View>
    </View>
  );
}

export function StudioDirector({
  selectedCount,
  disabled,
  onDirection,
  onStylist,
  onImportLink,
}: {
  selectedCount: number;
  disabled?: boolean;
  onDirection: (direction: StudioDirection) => void;
  onStylist: () => void;
  onImportLink: () => void;
}) {
  const directions: Array<{ id: StudioDirection; label: string; mark: string }> = [
    { id: "complete", label: selectedCount ? "Completar" : "Armar look", mark: "✦" },
    { id: "polished", label: "Más pulido", mark: "◇" },
    { id: "relaxed", label: "Más relajado", mark: "○" },
    { id: "layer", label: "Nueva capa", mark: "＋" },
    { id: "color_shift", label: "Otro color", mark: "◐" },
  ];
  return (
    <View style={[styles.director, disabled && styles.disabled]}>
      <View style={styles.directorHeader}>
        <View>
          <Text style={styles.microEyebrow}>DIRECTOR DE ESTILO</Text>
          <Text style={styles.directorTitle}>Decide antes de generar.</Text>
        </View>
        <Pressable style={styles.directorBriefButton} onPress={onStylist} disabled={disabled}>
          <Text style={styles.directorBriefText}>Brief</Text><Text style={styles.directorBriefArrow}>↗</Text>
        </Pressable>
      </View>
      <Text style={styles.directorCopy}>Vesta completa o remixa con prendas reales de tu armario. La generación del avatar ocurre solo cuando apruebas la combinación.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.directionRail}>
        {directions.map((direction) => (
          <Pressable key={direction.id} style={styles.directionChip} onPress={() => onDirection(direction.id)} disabled={disabled}>
            <Text style={styles.directionMark}>{direction.mark}</Text><Text style={styles.directionText}>{direction.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.linkAction} onPress={onImportLink} disabled={disabled}>
        <View style={styles.linkActionIcon}><Text style={styles.linkActionIconText}>↗</Text></View>
        <View style={styles.linkActionCopy}><Text style={styles.linkActionEyebrow}>PRENDA DE INTERNET</Text><Text style={styles.linkActionTitle}>Pega un link y llévala directo al Studio</Text></View>
        <Text style={styles.linkActionArrow}>›</Text>
      </Pressable>
    </View>
  );
}

export function AvatarRenderProgress({ quality }: { quality: "low" | "medium" }) {
  const [stage, setStage] = useState(0);
  const shimmer = useRef(new Animated.Value(0)).current;
  const stages = quality === "medium"
    ? ["Conservando tu identidad", "Refinando tela y volumen", "Equilibrando luz y detalle", "Preparando calidad editorial"]
    : ["Leyendo la combinación", "Ajustando las prendas al cuerpo", "Conservando rostro y proporción", "Preparando tu look"];

  useEffect(() => {
    setStage(0);
    const interval = setInterval(() => setStage((current) => Math.min(stages.length - 1, current + 1)), 2600);
    const loop = Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 1350, useNativeDriver: true }));
    loop.start();
    return () => {
      clearInterval(interval);
      loop.stop();
      shimmer.setValue(0);
    };
  }, [quality]);

  return (
    <View pointerEvents="none" style={styles.renderOverlay}>
      <View style={styles.renderCard}>
        <View style={styles.renderOrb}><Text style={styles.renderOrbText}>V</Text><View style={styles.renderOrbRing} /></View>
        <Text style={styles.renderEyebrow}>{quality === "medium" ? "VESTA EDITORIAL" : "VESTA QUICK LOOK"}</Text>
        <Text style={styles.renderTitle}>{stages[stage]}</Text>
        <Text style={styles.renderCopy}>El render usa tu avatar AI y las prendas que acabas de aprobar. Puedes salir de la app: el trabajo queda guardado.</Text>
        <View style={styles.renderTrack}>
          <Animated.View style={[styles.renderShimmer, { transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-95, 240] }) }] }]} />
        </View>
        <View style={styles.renderSteps}>
          {stages.map((_, index) => <View key={index} style={[styles.renderStep, index <= stage && styles.renderStepActive]} />)}
        </View>
      </View>
    </View>
  );
}

export function LookCollectionHeader({
  count,
  realCount,
  loading,
  progress,
  onDirect,
}: {
  count: number;
  realCount: number;
  loading: boolean;
  progress?: { current: number; total: number } | null;
  onDirect: () => void;
}) {
  return (
    <View style={styles.looksHeader}>
      <View style={styles.looksKickerRow}>
        <Text style={styles.microEyebrow}>TU EDITORIAL PRIVADO</Text>
        <Text style={styles.looksRealCount}>{realCount} LOOKS REALES</Text>
      </View>
      <Text style={styles.looksTitle}>Tus looks merecen pantalla completa.</Text>
      <Text style={styles.looksIntro}>Cada fotografía usa tu avatar AI. Vesta conserva el look, la explicación y sus prendas para que puedas editarlo o programarlo sin empezar de cero.</Text>
      <View style={styles.looksHeaderBottom}>
        <Text style={styles.looksCount}>{count} {count === 1 ? "LOOK" : "LOOKS"}</Text>
        <Pressable style={[styles.directLooksButton, loading && styles.disabled]} onPress={onDirect} disabled={loading}>
          {loading ? <ActivityIndicator color={paper} size="small" /> : <Text style={styles.directLooksButtonText}>Dirigir nuevos　✦</Text>}
        </Pressable>
      </View>
      {loading && progress ? <Text style={styles.looksProgress}>Vistiendo {progress.current} de {progress.total}…</Text> : null}
    </View>
  );
}

export function EditorialLookCard({
  visual,
  name,
  occasion,
  note,
  pieceCount,
  isReal,
  onOpen,
  onPlan,
  onEdit,
}: {
  visual: ReactNode;
  name: string;
  occasion: string;
  note?: string | null;
  pieceCount: number;
  isReal: boolean;
  onOpen: () => void;
  onPlan: () => void;
  onEdit: () => void;
}) {
  return (
    <View style={styles.editorialCard}>
      <Pressable style={styles.editorialVisual} onPress={onOpen}>
        {visual}
        <View pointerEvents="none" style={styles.editorialTopShade} />
        <View style={styles.editorialBadge}><View style={isReal ? styles.liveDot : styles.pendingDot} /><Text style={styles.editorialBadgeText}>{isReal ? "LOOK REAL" : "LISTO PARA RENDER"}</Text></View>
        <View style={styles.editorialIndex}><Text style={styles.editorialIndexText}>{String(pieceCount).padStart(2, "0")}</Text></View>
      </Pressable>
      <View style={styles.editorialCopy}>
        <Text style={styles.editorialOccasion}>{occasion.toUpperCase()}</Text>
        <Text style={styles.editorialTitle}>{name}</Text>
        <Text style={styles.editorialNote} numberOfLines={3}>{note || "Combinación construida con las prendas reales de tu armario."}</Text>
        <View style={styles.editorialActions}>
          <Pressable style={styles.editorialPrimary} onPress={onOpen}><Text style={styles.editorialPrimaryText}>Abrir</Text></Pressable>
          <Pressable style={styles.editorialAction} onPress={onPlan}><Text style={styles.editorialActionText}>Calendario</Text></Pressable>
          <Pressable style={styles.editorialAction} onPress={onEdit}><Text style={styles.editorialActionText}>Editar</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

export function StylistBriefModal<T extends NativeGarment>({
  visible,
  garments,
  initialAnchorIds,
  loading,
  renderGarment,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  garments: T[];
  initialAnchorIds?: string[];
  loading?: boolean;
  renderGarment: (garment: T) => ReactNode;
  onClose: () => void;
  onSubmit: (brief: StylistBrief) => void;
}) {
  const [occasion, setOccasion] = useState("Diario");
  const [weather, setWeather] = useState<StylistWeather>("templado");
  const [mood, setMood] = useState<StylistMood>("pulido");
  const [anchorIds, setAnchorIds] = useState<string[]>([]);
  const [variationSeed, setVariationSeed] = useState(1);

  useEffect(() => {
    if (!visible) return;
    setAnchorIds(Array.from(new Set((initialAnchorIds || []).map(String))).slice(0, 2));
    setVariationSeed((current) => current + 1);
  }, [visible]);

  const selectedAnchors = useMemo(() => new Set(anchorIds), [anchorIds]);
  const canCreate = useMemo(() => {
    const hasOnePiece = garments.some((garment) => garment.category === "one_piece");
    const hasTop = garments.some((garment) => garment.category === "tops");
    const hasBottom = garments.some((garment) => garment.category === "bottoms");
    return hasOnePiece || (hasTop && hasBottom);
  }, [garments]);
  const toggleAnchor = (id: NativeGarment["id"]) => {
    const value = String(id);
    setAnchorIds((current) => current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current.slice(-1), value]);
  };

  const submit = () => onSubmit({ occasion, weather, mood, seedGarmentIds: anchorIds, variationSeed });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.briefBackdrop}>
        <View style={styles.briefSheet}>
          <View style={styles.briefHandle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.briefContent}>
            <View style={styles.briefTopRow}>
              <View style={styles.briefBrand}><Text style={styles.briefBrandText}>V</Text></View>
              <Pressable style={styles.briefClose} onPress={onClose}><Text style={styles.briefCloseText}>×</Text></Pressable>
            </View>
            <Text style={styles.microEyebrow}>VESTA STYLIST</Text>
            <Text style={styles.briefTitle}>Dile a Vesta cómo quieres sentirte.</Text>
            <Text style={styles.briefIntro}>La combinación se decide primero. Después, Vesta crea tres fotografías reales en tu avatar para que compares sin imaginar.</Text>

            <BriefSection label="01 · OCASIÓN">
              <OptionRow values={["Diario", "Trabajo", "Cena", "Evento", "Viaje"]} selected={occasion} onSelect={setOccasion} />
            </BriefSection>
            <BriefSection label="02 · CLIMA">
              <OptionRow values={["calor", "templado", "frío", "lluvia"]} selected={weather} onSelect={(value) => setWeather(value as StylistWeather)} />
            </BriefSection>
            <BriefSection label="03 · DIRECCIÓN">
              <OptionRow values={["minimal", "relajado", "pulido", "atrevido"]} selected={mood} onSelect={(value) => setMood(value as StylistMood)} />
            </BriefSection>

            <BriefSection label="04 · PRENDA ANCLA · OPCIONAL">
              <Text style={styles.anchorHint}>Elige hasta dos. Vesta construirá alrededor de ellas siempre que sean compatibles.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.anchorRail}>
                {garments.slice(0, 24).map((garment) => {
                  const active = selectedAnchors.has(String(garment.id));
                  return (
                    <Pressable key={String(garment.id)} style={[styles.anchorCard, active && styles.anchorCardActive]} onPress={() => toggleAnchor(garment.id)}>
                      <View style={styles.anchorVisual}>{renderGarment(garment)}</View>
                      <Text style={styles.anchorName} numberOfLines={2}>{garment.name}</Text>
                      {active ? <View style={styles.anchorCheck}><Text style={styles.anchorCheckText}>✓</Text></View> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </BriefSection>

            <View style={styles.briefSummary}>
              <Text style={styles.briefSummaryEyebrow}>BRIEF LISTO</Text>
              <Text style={styles.briefSummaryText}>{occasion} · {weather} · {mood}{anchorIds.length ? ` · ${anchorIds.length} ancla${anchorIds.length > 1 ? "s" : ""}` : ""}</Text>
            </View>
            <Pressable style={[styles.briefSubmit, loading && styles.disabled]} onPress={submit} disabled={loading || !canCreate}>
              {loading ? <ActivityIndicator color={paper} /> : <><Text style={styles.briefSubmitText}>Crear 3 looks en mi avatar</Text><Text style={styles.briefSubmitMark}>✦</Text></>}
            </Pressable>
            <Text style={styles.briefFootnote}>{canCreate
              ? "Solo se generan fotografías después de crear combinaciones válidas con tu propio armario."
              : "Prepara una prenda completa o al menos una parte de arriba y una de abajo para continuar."}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BriefSection({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.briefSection}><Text style={styles.briefSectionLabel}>{label}</Text>{children}</View>;
}

function OptionRow({ values, selected, onSelect }: { values: string[]; selected: string; onSelect: (value: string) => void }) {
  return (
    <View style={styles.optionRow}>
      {values.map((value) => (
        <Pressable key={value} style={[styles.option, selected === value && styles.optionActive]} onPress={() => onSelect(value)}>
          <Text style={[styles.optionText, selected === value && styles.optionTextActive]}>{value}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.48 },
  microEyebrow: { color: rust, fontSize: 7, fontWeight: "900", letterSpacing: 1.25 },
  todayHero: { overflow: "hidden", borderRadius: 28, backgroundColor: ink, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 26, shadowOffset: { width: 0, height: 14 }, elevation: 10 },
  todayVisual: { position: "relative", height: 510, overflow: "hidden", backgroundColor: "#EDEAE5" },
  todayAvatar: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, width: "100%", height: "100%" },
  todayBlank: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#DCD8D0" },
  todayBlankMark: { color: "rgba(14,14,14,.15)", fontFamily: serif, fontSize: 170, lineHeight: 180 },
  todayBlankText: { position: "absolute", bottom: 170, color: "rgba(14,14,14,.55)", fontSize: 7, fontWeight: "900", letterSpacing: 1.4 },
  todayTopShade: { position: "absolute", left: 0, right: 0, top: 0, height: 100, backgroundColor: "rgba(0,0,0,.20)" },
  todayBottomShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 260, backgroundColor: "rgba(0,0,0,.66)" },
  todayTopRow: { position: "absolute", left: 16, right: 16, top: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  todayBadge: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, backgroundColor: "rgba(255,255,255,.88)" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#71826A" },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: rust },
  todayBadgeText: { color: ink, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.05 },
  todayTopMeta: { color: paper, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.05, textShadowColor: "rgba(0,0,0,.28)", textShadowRadius: 4 },
  todayCopy: { position: "absolute", left: 20, right: 20, bottom: 22 },
  todayEyebrow: { color: "#E4A98E", fontSize: 7, fontWeight: "900", letterSpacing: 1.3 },
  todayTitle: { maxWidth: 330, color: paper, fontFamily: serif, fontSize: 37, lineHeight: 39, letterSpacing: -1.5, marginTop: 7 },
  todaySubtitle: { maxWidth: 318, color: "rgba(255,255,255,.74)", fontSize: 9, lineHeight: 14, marginTop: 10 },
  todayActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 },
  todayPrimary: { minHeight: 45, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: 24, backgroundColor: paper },
  todayPrimaryText: { color: ink, fontSize: 9, fontWeight: "900" },
  todaySecondary: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,.38)", backgroundColor: "rgba(0,0,0,.16)" },
  todaySecondaryText: { color: paper, fontSize: 9, fontWeight: "800" },
  todaySecondaryArrow: { color: "#E4A98E", fontSize: 13, fontWeight: "800" },
  pulseRail: { minHeight: 82, flexDirection: "row", alignItems: "center", backgroundColor: ink },
  pulseMetric: { flex: 1, alignItems: "center", justifyContent: "center" },
  pulseValue: { color: paper, fontFamily: serif, fontSize: 24, lineHeight: 27 },
  pulseLabel: { color: "rgba(255,255,255,.48)", fontSize: 5.7, fontWeight: "900", letterSpacing: 0.85, marginTop: 4 },
  metricDivider: { width: StyleSheet.hairlineWidth, height: 31, backgroundColor: "rgba(255,255,255,.18)" },
  intelligencePanel: { marginTop: 18, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: line, backgroundColor: paper },
  intelligenceHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  intelligenceTitle: { color: ink, fontFamily: serif, fontSize: 25, lineHeight: 28, marginTop: 4 },
  coveragePill: { alignItems: "center", justifyContent: "center", minWidth: 68, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 16, backgroundColor: soft },
  coverageValue: { color: ink, fontSize: 15, fontWeight: "900" },
  coverageLabel: { color: muted, fontSize: 5.5, fontWeight: "900", letterSpacing: 0.7, marginTop: 2 },
  paletteRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: line },
  paletteLabel: { color: muted, fontSize: 6, fontWeight: "900", letterSpacing: 1 },
  paletteValue: { color: ink, fontSize: 9, fontWeight: "800" },
  nextMove: { color: muted, fontSize: 9, lineHeight: 15, marginTop: 13 },
  intelligenceActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 15 },
  intelligencePrimary: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: rust },
  intelligencePrimaryText: { color: paper, fontSize: 8.5, fontWeight: "900" },
  intelligenceQuiet: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: line },
  intelligenceQuietText: { color: ink, fontSize: 8, fontWeight: "800" },
  director: { marginBottom: 15, padding: 15, borderRadius: 20, backgroundColor: ink },
  directorHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  directorTitle: { color: paper, fontFamily: serif, fontSize: 22, lineHeight: 25, marginTop: 4 },
  directorBriefButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, backgroundColor: paper },
  directorBriefText: { color: ink, fontSize: 8, fontWeight: "900" },
  directorBriefArrow: { color: rust, fontSize: 12, fontWeight: "900" },
  directorCopy: { maxWidth: 315, color: "rgba(255,255,255,.62)", fontSize: 8, lineHeight: 13, marginTop: 10 },
  directionRail: { gap: 7, paddingTop: 13, paddingRight: 12 },
  directionChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 19, borderWidth: 1, borderColor: "rgba(255,255,255,.22)", backgroundColor: "rgba(255,255,255,.08)" },
  directionMark: { color: "#E4A98E", fontSize: 11, fontWeight: "800" },
  directionText: { color: paper, fontSize: 8, fontWeight: "800" },
  linkAction: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 13, paddingTop: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(255,255,255,.20)" },
  linkActionIcon: { width: 31, height: 31, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: rust },
  linkActionIconText: { color: paper, fontSize: 13, fontWeight: "900" },
  linkActionCopy: { flex: 1 },
  linkActionEyebrow: { color: "rgba(255,255,255,.48)", fontSize: 5.5, fontWeight: "900", letterSpacing: 0.85 },
  linkActionTitle: { color: paper, fontSize: 8.5, fontWeight: "800", marginTop: 3 },
  linkActionArrow: { color: "rgba(255,255,255,.54)", fontSize: 22, fontWeight: "300" },
  renderOverlay: { position: "absolute", zIndex: 40, left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 18, backgroundColor: "rgba(10,10,10,.74)" },
  renderCard: { width: "100%", maxWidth: 285, alignItems: "center", paddingHorizontal: 24, paddingVertical: 26, borderRadius: 25, backgroundColor: "rgba(255,255,255,.97)" },
  renderOrb: { position: "relative", width: 62, height: 62, alignItems: "center", justifyContent: "center", borderRadius: 31, backgroundColor: ink },
  renderOrbRing: { position: "absolute", left: -7, right: -7, top: -7, bottom: -7, borderRadius: 38, borderWidth: 1, borderColor: "rgba(163,79,49,.35)" },
  renderOrbText: { color: paper, fontFamily: serif, fontSize: 27 },
  renderEyebrow: { color: rust, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.2, marginTop: 19 },
  renderTitle: { color: ink, fontFamily: serif, fontSize: 22, lineHeight: 25, textAlign: "center", marginTop: 6 },
  renderCopy: { color: muted, fontSize: 8, lineHeight: 13, textAlign: "center", marginTop: 9 },
  renderTrack: { width: "100%", height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: "#E7E5E1", marginTop: 18 },
  renderShimmer: { width: 95, height: 4, borderRadius: 2, backgroundColor: rust },
  renderSteps: { flexDirection: "row", gap: 5, marginTop: 11 },
  renderStep: { width: 18, height: 3, borderRadius: 2, backgroundColor: "#DDD9D2" },
  renderStepActive: { backgroundColor: rust },
  looksHeader: { paddingTop: 5, paddingBottom: 22 },
  looksKickerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  looksRealCount: { color: muted, fontSize: 6, fontWeight: "900", letterSpacing: 0.9 },
  looksTitle: { maxWidth: 345, color: ink, fontFamily: serif, fontSize: 39, lineHeight: 41, letterSpacing: -1.5, marginTop: 8 },
  looksIntro: { maxWidth: 335, color: muted, fontSize: 9, lineHeight: 15, marginTop: 11 },
  looksHeaderBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18 },
  looksCount: { color: ink, fontSize: 7, fontWeight: "900", letterSpacing: 1.1 },
  directLooksButton: { minWidth: 132, minHeight: 43, alignItems: "center", justifyContent: "center", paddingHorizontal: 15, borderRadius: 22, backgroundColor: rust },
  directLooksButtonText: { color: paper, fontSize: 8.5, fontWeight: "900" },
  looksProgress: { color: rust, fontSize: 7, fontWeight: "800", textAlign: "right", marginTop: 8 },
  editorialCard: { overflow: "hidden", marginBottom: 22, borderRadius: 27, borderWidth: 1, borderColor: line, backgroundColor: paper, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  editorialVisual: { position: "relative", height: 500, overflow: "hidden", backgroundColor: soft },
  editorialTopShade: { position: "absolute", left: 0, right: 0, top: 0, height: 88, backgroundColor: "rgba(0,0,0,.17)" },
  editorialBadge: { position: "absolute", left: 14, top: 14, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 17, backgroundColor: "rgba(255,255,255,.90)" },
  editorialBadgeText: { color: ink, fontSize: 6, fontWeight: "900", letterSpacing: 0.9 },
  editorialIndex: { position: "absolute", right: 14, top: 14, width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "rgba(0,0,0,.64)" },
  editorialIndexText: { color: paper, fontFamily: serif, fontSize: 13 },
  editorialCopy: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 18 },
  editorialOccasion: { color: rust, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.1 },
  editorialTitle: { color: ink, fontFamily: serif, fontSize: 28, lineHeight: 31, letterSpacing: -0.8, marginTop: 5 },
  editorialNote: { color: muted, fontSize: 8.5, lineHeight: 14, marginTop: 9 },
  editorialActions: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 15 },
  editorialPrimary: { flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 21, backgroundColor: ink },
  editorialPrimaryText: { color: paper, fontSize: 8.5, fontWeight: "900" },
  editorialAction: { minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: 21, borderWidth: 1, borderColor: line },
  editorialActionText: { color: ink, fontSize: 7.5, fontWeight: "800" },
  briefBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.58)" },
  briefSheet: { maxHeight: "96%", overflow: "hidden", borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: paper },
  briefHandle: { width: 38, height: 4, alignSelf: "center", borderRadius: 2, backgroundColor: "#D8D5CF", marginTop: 9 },
  briefContent: { paddingHorizontal: 20, paddingTop: 15, paddingBottom: Platform.OS === "ios" ? 42 : 30 },
  briefTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 19 },
  briefBrand: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: ink },
  briefBrandText: { color: paper, fontFamily: serif, fontSize: 18 },
  briefClose: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18, backgroundColor: soft },
  briefCloseText: { color: ink, fontSize: 24, lineHeight: 25, fontWeight: "300" },
  briefTitle: { maxWidth: 345, color: ink, fontFamily: serif, fontSize: 38, lineHeight: 40, letterSpacing: -1.5, marginTop: 7 },
  briefIntro: { maxWidth: 340, color: muted, fontSize: 9, lineHeight: 15, marginTop: 11 },
  briefSection: { paddingTop: 20, marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: line },
  briefSectionLabel: { color: ink, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.1, marginBottom: 11 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  option: { minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: 19, borderWidth: 1, borderColor: line, backgroundColor: paper },
  optionActive: { borderColor: ink, backgroundColor: ink },
  optionText: { color: muted, fontSize: 8, fontWeight: "700", textTransform: "capitalize" },
  optionTextActive: { color: paper, fontWeight: "900" },
  anchorHint: { color: muted, fontSize: 7.5, lineHeight: 12, marginTop: -3, marginBottom: 11 },
  anchorRail: { gap: 8, paddingRight: 15 },
  anchorCard: { position: "relative", width: 94, overflow: "hidden", borderWidth: 1, borderColor: line, borderRadius: 14, backgroundColor: paper },
  anchorCardActive: { borderWidth: 2, borderColor: rust },
  anchorVisual: { width: "100%", aspectRatio: 1, overflow: "hidden", backgroundColor: soft },
  anchorName: { minHeight: 37, color: ink, fontSize: 7.2, lineHeight: 10, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 7 },
  anchorCheck: { position: "absolute", right: 6, top: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: rust },
  anchorCheckText: { color: paper, fontSize: 9, fontWeight: "900" },
  briefSummary: { marginTop: 22, padding: 14, borderRadius: 17, backgroundColor: soft },
  briefSummaryEyebrow: { color: rust, fontSize: 6, fontWeight: "900", letterSpacing: 1 },
  briefSummaryText: { color: ink, fontSize: 9, fontWeight: "800", textTransform: "capitalize", marginTop: 5 },
  briefSubmit: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, borderRadius: 27, backgroundColor: rust, marginTop: 13 },
  briefSubmitText: { color: paper, fontSize: 10, fontWeight: "900" },
  briefSubmitMark: { color: "#F2C3AA", fontSize: 17 },
  briefFootnote: { color: muted, fontSize: 6.5, lineHeight: 10, textAlign: "center", marginTop: 10 },
});
