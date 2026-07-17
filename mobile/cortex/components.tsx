import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { longDateLabel, planModeLabel, shortDateLabel } from "./logic";
import { renderStageLabel } from "./renderQueue";
import type {
  DayBrief,
  Notice,
  OutfitCandidate,
  PlannedDay,
  RenderJob,
  StyleDNA,
  WardrobeAnalysis,
  WardrobeItem,
  WeekPlan,
} from "./types";

export const palette = {
  ink: "#0D0F14",
  paper: "#F7F7F5",
  white: "#FFFFFF",
  smoke: "#ECEDE9",
  line: "#D9DBD5",
  muted: "#6E736C",
  cobalt: "#3157F6",
  cobaltSoft: "#E8EDFF",
  lime: "#C7FF56",
  limeSoft: "#F0FFD5",
  coral: "#FF6F61",
  gold: "#F4C96B",
  success: "#297A55",
  danger: "#A64338",
};

export function BrandHeader({ connected, avatarSource, onProfile }: { connected: boolean; avatarSource?: ImageSourcePropType | null; onProfile: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandLockup}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>V</Text></View>
        <View><Text style={styles.brandName}>VESTA</Text><Text style={styles.brandSub}>CORTEX · RUNWAY</Text></View>
      </View>
      <View style={styles.connectionPill}><View style={[styles.connectionDot, !connected && styles.connectionDotOffline]} /><Text style={styles.connectionText}>{connected ? "PRIVADO" : "CONECTAR"}</Text></View>
      <Pressable style={styles.avatarButton} onPress={onProfile} accessibilityLabel="Cuenta y avatar">
        {avatarSource ? <Image source={avatarSource} style={styles.avatarImage} /> : <Text style={styles.avatarFallback}>YO</Text>}
      </Pressable>
    </View>
  );
}

export function BottomNav({ tab, onChange }: { tab: string; onChange: (tab: string) => void }) {
  const tabs = [
    { id: "runway", label: "Runway", icon: "◇" },
    { id: "lab", label: "Lab", icon: "✦" },
    { id: "cortex", label: "Cortex", icon: "◎" },
    { id: "closet", label: "Armario", icon: "▦" },
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map((entry) => (
        <Pressable key={entry.id} style={styles.navItem} onPress={() => onChange(entry.id)}>
          <Text style={[styles.navIcon, tab === entry.id && styles.navActive]}>{entry.icon}</Text>
          <Text style={[styles.navLabel, tab === entry.id && styles.navActive]}>{entry.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <Pressable style={[styles.notice, notice.tone === "success" && styles.noticeSuccess, notice.tone === "error" && styles.noticeError]} onPress={onClose}>
      <View style={{ flex: 1 }}><Text style={styles.noticeTitle}>{notice.title}</Text>{notice.message ? <Text style={styles.noticeMessage}>{notice.message}</Text> : null}</View>
      <Text style={styles.noticeClose}>×</Text>
    </Pressable>
  );
}

export function DayStrip({ days, selectedDate, onSelect }: { days: PlannedDay[]; selectedDate: string; onSelect: (date: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayStrip}>
      {days.map((day) => {
        const selected = day.brief.date === selectedDate;
        const label = shortDateLabel(day.brief.date);
        return (
          <Pressable key={day.brief.date} style={[styles.dayChip, selected && styles.dayChipSelected]} onPress={() => onSelect(day.brief.date)}>
            <Text style={[styles.dayWeekday, selected && styles.dayTextSelected]}>{day.brief.label || label.weekday}</Text>
            <Text style={[styles.dayNumber, selected && styles.dayTextSelected]}>{label.day}</Text>
            <View style={[styles.dayStatus, day.localRenderUri && styles.dayStatusReady, day.locked && styles.dayStatusLocked]} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function CinematicHero({
  day,
  imageSource,
  avatarSource,
  renderJob,
  onRender,
  onUpgrade,
  onLock,
  onRegenerate,
  onOpenLegacy,
}: {
  day: PlannedDay | null;
  imageSource?: ImageSourcePropType | null;
  avatarSource?: ImageSourcePropType | null;
  renderJob?: RenderJob | null;
  onRender: () => void;
  onUpgrade: () => void;
  onLock: () => void;
  onRegenerate: () => void;
  onOpenLegacy: () => void;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    entrance.setValue(0);
    Animated.spring(entrance, { toValue: 1, damping: 18, stiffness: 155, mass: .8, useNativeDriver: true }).start();
  }, [day?.candidate.signature, entrance]);
  const source = imageSource || avatarSource || null;
  return (
    <Animated.View style={[styles.hero, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>
      <View style={styles.heroVisual}>
        {source ? <Image source={source} resizeMode="cover" style={styles.heroImage} /> : (
          <Pressable style={styles.heroEmpty} onPress={onOpenLegacy}>
            <Text style={styles.heroEmptyMark}>V</Text><Text style={styles.heroEmptyTitle}>Crea tu avatar AI</Text><Text style={styles.heroEmptyCopy}>Selfie + cuerpo completo. Después Vesta puede construir toda la semana sobre ti.</Text>
          </Pressable>
        )}
        <View style={styles.heroTopScrim} />
        <View style={styles.heroBottomScrim} />
        <View style={styles.heroFloatingHeader}>
          <View><Text style={styles.heroEyebrow}>{day ? longDateLabel(day.brief.date).toUpperCase() : "VESTA RUNWAY"}</Text><Text style={styles.heroTitle}>{day?.candidate.name || "Tu semana, dirigida"}</Text></View>
          {day ? <Pressable style={[styles.lockButton, day.locked && styles.lockButtonActive]} onPress={onLock}><Text style={[styles.lockButtonText, day.locked && styles.lockButtonTextActive]}>{day.locked ? "FIJO" : "FIJAR"}</Text></Pressable> : null}
        </View>
        {day ? (
          <View style={styles.heroCaption}>
            <Text style={styles.heroRationale} numberOfLines={3}>{day.candidate.rationale}</Text>
            <View style={styles.signalRow}>{day.candidate.signals.slice(0, 3).map((signal) => <View key={signal} style={styles.signalPill}><Text style={styles.signalText}>{signal}</Text></View>)}</View>
          </View>
        ) : null}
        {renderJob && !["ready", "failed", "cancelled"].includes(renderJob.stage) ? <RenderOverlay job={renderJob} /> : null}
      </View>
      {day ? (
        <View style={styles.heroActions}>
          {!day.localRenderUri && renderJob?.stage !== "ready" ? <ActionButton label="VERME CON ESTE LOOK" primary onPress={onRender} /> : <ActionButton label="CALIDAD EDITORIAL" primary onPress={onUpgrade} />}
          <ActionButton label="OTRA DIRECCIÓN" onPress={onRegenerate} />
        </View>
      ) : <ActionButton label="ABRIR VESTA" primary onPress={onOpenLegacy} />}
    </Animated.View>
  );
}

export function RenderOverlay({ job }: { job: RenderJob }) {
  const pulse = useRef(new Animated.Value(.35)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: .9, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: .35, duration: 900, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse]);
  return (
    <View style={styles.renderOverlay}>
      <Animated.View style={[styles.renderOrb, { opacity: pulse }]}><Text style={styles.renderOrbText}>V</Text></Animated.View>
      <Text style={styles.renderTitle}>{renderStageLabel(job.stage, job.quality)}</Text>
      <Text style={styles.renderCopy}>La cola persiste si cierras la app. Vesta reanudará este render sin perder la combinación.</Text>
    </View>
  );
}

function ActionButton({ label, onPress, primary = false, disabled = false }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return <Pressable style={[styles.actionButton, primary && styles.actionButtonPrimary, disabled && styles.disabled]} onPress={onPress} disabled={disabled}><Text style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}>{label}</Text></Pressable>;
}

export function WeekPlanPicker({ plans, selectedId, onSelect }: { plans: WeekPlan[]; selectedId?: string | null; onSelect: (plan: WeekPlan) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.planPicker}>
      {plans.map((plan) => (
        <Pressable key={plan.id} style={[styles.planModeCard, selectedId === plan.id && styles.planModeCardActive]} onPress={() => onSelect(plan)}>
          <Text style={[styles.planModeEyebrow, selectedId === plan.id && styles.planModeEyebrowActive]}>{planModeLabel(plan.mode).toUpperCase()}</Text>
          <Text style={[styles.planModeScore, selectedId === plan.id && styles.planModeScoreActive]}>{Math.round(plan.score * 100)}</Text>
          <Text style={[styles.planModeMeta, selectedId === plan.id && styles.planModeMetaActive]}>{plan.stats.uniqueGarments} prendas · {plan.stats.repeatedCorePieces} repeticiones</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function PlanMetrics({ plan }: { plan: WeekPlan }) {
  const entries = [
    ["PIEZAS ÚNICAS", plan.stats.uniqueGarments],
    ["RECUPERADAS", plan.stats.underusedGarmentsRecovered],
    ["PALETAS", plan.stats.colorFamilies],
    ["REPETICIONES", plan.stats.repeatedCorePieces],
  ] as const;
  return (
    <View style={styles.metricGrid}>{entries.map(([label, value]) => <View key={label} style={styles.metricCard}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>)}</View>
  );
}

export function CompareSlider({ left, right, leftLabel, rightLabel }: { left: ImageSourcePropType; right: ImageSourcePropType; leftLabel: string; rightLabel: string }) {
  const [width, setWidth] = useState(1);
  const [ratio, setRatio] = useState(.5);
  const ratioRef = useRef(.5);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event: any) => {
      const next = Math.max(0, Math.min(1, event.nativeEvent.locationX / Math.max(1, width)));
      ratioRef.current = next;
      setRatio(next);
    },
    onPanResponderMove: (event: any) => {
      const next = Math.max(0, Math.min(1, event.nativeEvent.locationX / Math.max(1, width)));
      ratioRef.current = next;
      setRatio(next);
    },
  }), [width]);
  return (
    <View style={styles.compareRoot} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}>
      <Image source={right} resizeMode="cover" style={styles.compareImage} />
      <View style={[styles.compareClip, { width: width * ratio }]}><Image source={left} resizeMode="cover" style={[styles.compareImage, { width }]} /></View>
      <View style={[styles.compareLine, { left: width * ratio - 1 }]}><View style={styles.compareHandle}><Text style={styles.compareHandleText}>↔</Text></View></View>
      <View style={styles.compareLabels}><Text style={styles.compareLabel}>{leftLabel}</Text><Text style={styles.compareLabel}>{rightLabel}</Text></View>
    </View>
  );
}

export const CandidateCard = memo(function CandidateCard({ candidate, selected, onPress, onRender, renderJob }: { candidate: OutfitCandidate; selected?: boolean; onPress: () => void; onRender: () => void; renderJob?: RenderJob | null }) {
  return (
    <Pressable style={[styles.candidateCard, selected && styles.candidateCardSelected]} onPress={onPress}>
      <View style={styles.candidateHeader}><View style={{ flex: 1 }}><Text style={styles.candidateEyebrow}>{Math.round(candidate.score.total * 100)} · CORTEX</Text><Text style={styles.candidateName}>{candidate.name}</Text></View><Text style={styles.candidateArrow}>›</Text></View>
      <GarmentStrip garments={candidate.garments} />
      <Text style={styles.candidateRationale} numberOfLines={3}>{candidate.rationale}</Text>
      <View style={styles.candidateFooter}><View style={styles.signalRow}>{candidate.signals.slice(0, 2).map((signal) => <View key={signal} style={styles.signalPillLight}><Text style={styles.signalTextDark}>{signal}</Text></View>)}</View><Pressable style={styles.smallRenderButton} onPress={onRender}><Text style={styles.smallRenderText}>{renderJob && !["ready", "failed", "cancelled"].includes(renderJob.stage) ? "CREANDO…" : "RENDER"}</Text></Pressable></View>
    </Pressable>
  );
});

export function GarmentStrip({ garments, onGarment }: { garments: WardrobeItem[]; onGarment?: (item: WardrobeItem) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.garmentStrip}>
      {garments.map((item) => <Pressable key={String(item.id)} style={styles.garmentChip} onPress={() => onGarment?.(item)}><Text style={styles.garmentChipSlot}>{String(item.category).replace("one_piece", "one")}</Text><Text style={styles.garmentChipName} numberOfLines={1}>{item.name}</Text><Text style={styles.garmentChipColor} numberOfLines={1}>{item.color || "Sin color"}</Text></Pressable>)}
    </ScrollView>
  );
}

export function BriefDayEditor({ brief, onChange }: { brief: DayBrief; onChange: (patch: Partial<DayBrief>) => void }) {
  return (
    <View style={styles.briefCard}>
      <Text style={styles.sectionEyebrow}>{longDateLabel(brief.date).toUpperCase()}</Text>
      <Text style={styles.sectionTitle}>Dirige el contexto</Text>
      <ChoiceRow label="OCASIÓN" values={["daily", "work", "date", "event", "travel", "weekend"]} selected={brief.occasion} labels={["Diario", "Trabajo", "Cita", "Evento", "Viaje", "Finde"]} onSelect={(value) => onChange({ occasion: value as DayBrief["occasion"] })} />
      <ChoiceRow label="CLIMA" values={["hot", "mild", "cold", "rain"]} selected={brief.weather} labels={["Calor", "Templado", "Frío", "Lluvia"]} onSelect={(value) => onChange({ weather: value as DayBrief["weather"] })} />
      <ChoiceRow label="DIRECCIÓN" values={["minimal", "relaxed", "polished", "bold"]} selected={brief.direction} labels={["Minimal", "Relajado", "Pulido", "Atrevido"]} onSelect={(value) => onChange({ direction: value as DayBrief["direction"] })} />
    </View>
  );
}

function ChoiceRow({ label, values, labels, selected, onSelect }: { label: string; values: string[]; labels: string[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.choiceSection}><Text style={styles.choiceLabel}>{label}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{values.map((value, index) => <Pressable key={value} style={[styles.choicePill, selected === value && styles.choicePillActive]} onPress={() => onSelect(value)}><Text style={[styles.choicePillText, selected === value && styles.choicePillTextActive]}>{labels[index]}</Text></Pressable>)}</ScrollView></View>;
}

export function StyleDNAPanel({ dna, profileActions }: { dna: StyleDNA; profileActions: number }) {
  const entries: Array<[keyof StyleDNA, string]> = [
    ["minimal", "Minimal"], ["relaxed", "Relajado"], ["polished", "Pulido"], ["bold", "Atrevido"], ["warm", "Cálido"], ["cool", "Frío"], ["tonal", "Tonal"], ["layered", "Capas"],
  ];
  return (
    <View style={styles.dnaPanel}><View style={styles.dnaHeader}><View><Text style={styles.sectionEyebrow}>MODELO PERSONAL</Text><Text style={styles.sectionTitle}>Tu Style DNA</Text></View><Text style={styles.dnaActions}>{profileActions} señales</Text></View>{entries.map(([key, label]) => <View key={key} style={styles.dnaRow}><Text style={styles.dnaLabel}>{label}</Text><View style={styles.dnaTrack}><View style={[styles.dnaFill, { width: `${Math.round(dna[key] * 100)}%` }]} /></View><Text style={styles.dnaValue}>{Math.round(dna[key] * 100)}</Text></View>)}</View>
  );
}

export function WardrobeGraphPanel({ analysis, onOpenCloset }: { analysis: WardrobeAnalysis; onOpenCloset: () => void }) {
  return (
    <View style={styles.graphPanel}>
      <View style={styles.graphHeader}><View><Text style={styles.sectionEyebrow}>GRAFO DEL ARMARIO</Text><Text style={styles.sectionTitle}>Qué conecta todo</Text></View><Pressable onPress={onOpenCloset}><Text style={styles.inlineLink}>ABRIR ARMARIO</Text></Pressable></View>
      <View style={styles.graphMetrics}><GraphMetric value={analysis.potentialOutfits} label="OUTFITS POSIBLES" /><GraphMetric value={`${Math.round(analysis.coverage * 100)}%`} label="COBERTURA" /><GraphMetric value={analysis.communities.length} label="CLUSTERS" /></View>
      <Text style={styles.graphSubtitle}>HÉROES DE VERSATILIDAD</Text>
      {analysis.heroes.slice(0, 4).map((node, index) => <View key={node.garmentId} style={styles.heroNodeRow}><Text style={styles.heroNodeRank}>0{index + 1}</Text><View style={styles.heroNodeTrack}><View style={[styles.heroNodeFill, { width: `${Math.round(node.versatility * 100)}%` }]} /></View><Text style={styles.heroNodeValue}>{Math.round(node.versatility * 100)}</Text></View>)}
      <View style={styles.graphGap}><Text style={styles.graphGapLabel}>SIGUIENTE MOVIMIENTO</Text><Text style={styles.graphGapText}>{analysis.gaps[0]}</Text></View>
    </View>
  );
}

function GraphMetric({ value, label }: { value: number | string; label: string }) {
  return <View style={styles.graphMetric}><Text style={styles.graphMetricValue}>{value}</Text><Text style={styles.graphMetricLabel}>{label}</Text></View>;
}

export function RenderQueueTray({ jobs, onRetry }: { jobs: RenderJob[]; onRetry: (jobId: string) => void }) {
  const visible = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  if (!visible.length) return null;
  return <View style={styles.queueTray}><Text style={styles.sectionEyebrow}>COLA DE AVATAR</Text>{visible.map((job) => <View key={job.id} style={styles.queueRow}><View style={[styles.queueDot, job.stage === "ready" && styles.queueDotReady, job.stage === "failed" && styles.queueDotFailed]} /><View style={{ flex: 1 }}><Text style={styles.queueTitle}>{renderStageLabel(job.stage, job.quality)}</Text><Text style={styles.queueMeta}>{job.garmentIds.length} prendas · {job.quality === "medium" ? "editorial" : "rápido"}</Text></View>{job.stage === "failed" ? <Pressable onPress={() => onRetry(job.id)}><Text style={styles.queueRetry}>REINTENTAR</Text></Pressable> : null}</View>)}</View>;
}

export function EmptyConnection({ onConnect }: { onConnect: () => void }) {
  return <View style={styles.connectionScreen}><View style={styles.connectionMark}><Text style={styles.connectionMarkText}>V</Text></View><Text style={styles.connectionTitle}>Vesta Cortex necesita tu cuenta privada</Text><Text style={styles.connectionCopy}>El motor corre en el dispositivo. La nube solo se usa para sincronizar tu armario y generar las fotografías del avatar.</Text><ActionButton label="CONECTAR VESTA" primary onPress={onConnect} /></View>;
}

const styles = StyleSheet.create({
  header: { height: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, backgroundColor: palette.paper },
  brandLockup: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandMark: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: palette.ink },
  brandMarkText: { color: palette.lime, fontSize: 16, fontWeight: "900", fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  brandName: { color: palette.ink, fontSize: 10, fontWeight: "900", letterSpacing: 1.6 },
  brandSub: { color: palette.muted, fontSize: 5.5, fontWeight: "800", letterSpacing: 1.1, marginTop: 2 },
  connectionPill: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 15, backgroundColor: palette.white },
  connectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.success },
  connectionDotOffline: { backgroundColor: palette.coral },
  connectionText: { color: palette.muted, fontSize: 6, fontWeight: "900", letterSpacing: .8 },
  avatarButton: { width: 34, height: 34, marginLeft: 9, borderRadius: 17, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.ink },
  avatarImage: { width: "100%", height: "100%" },
  avatarFallback: { color: palette.ink, fontSize: 8, fontWeight: "900" },
  bottomNav: { position: "absolute", zIndex: 30, left: 16, right: 16, bottom: Platform.OS === "ios" ? 14 : 10, height: 70, flexDirection: "row", alignItems: "center", borderRadius: 25, backgroundColor: palette.ink, shadowColor: "#000", shadowOpacity: .22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  navItem: { flex: 1, height: 62, alignItems: "center", justifyContent: "center", gap: 3 },
  navIcon: { color: "#747982", fontSize: 18 },
  navLabel: { color: "#747982", fontSize: 7.5, fontWeight: "800" },
  navActive: { color: palette.lime },
  notice: { position: "absolute", zIndex: 100, top: 70, left: 14, right: 14, minHeight: 58, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 15, paddingVertical: 12, borderRadius: 16, backgroundColor: palette.ink, shadowColor: "#000", shadowOpacity: .18, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  noticeSuccess: { backgroundColor: palette.success }, noticeError: { backgroundColor: palette.danger },
  noticeTitle: { color: palette.white, fontSize: 11, fontWeight: "900" }, noticeMessage: { color: "rgba(255,255,255,.8)", fontSize: 8, lineHeight: 12, marginTop: 3 }, noticeClose: { color: palette.white, fontSize: 22 },
  dayStrip: { gap: 7, paddingHorizontal: 16, paddingVertical: 13 },
  dayChip: { width: 56, height: 68, alignItems: "center", justifyContent: "center", borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white },
  dayChipSelected: { borderColor: palette.ink, backgroundColor: palette.ink },
  dayWeekday: { color: palette.muted, fontSize: 7, fontWeight: "800" }, dayNumber: { color: palette.ink, fontSize: 19, fontWeight: "900", marginTop: 3 }, dayTextSelected: { color: palette.white },
  dayStatus: { position: "absolute", bottom: 7, width: 4, height: 4, borderRadius: 2, backgroundColor: palette.line }, dayStatusReady: { backgroundColor: palette.lime }, dayStatusLocked: { width: 12, borderRadius: 3, backgroundColor: palette.gold },
  hero: { marginHorizontal: 16, marginBottom: 18 },
  heroVisual: { position: "relative", height: 520, overflow: "hidden", borderRadius: 28, backgroundColor: palette.ink },
  heroImage: { width: "100%", height: "100%" },
  heroEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, backgroundColor: palette.ink },
  heroEmptyMark: { color: palette.lime, fontSize: 64, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) }, heroEmptyTitle: { color: palette.white, fontSize: 25, fontWeight: "800", marginTop: 12, textAlign: "center" }, heroEmptyCopy: { color: "#9DA3AE", fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 8 },
  heroTopScrim: { position: "absolute", left: 0, right: 0, top: 0, height: 150, backgroundColor: "rgba(0,0,0,.18)" }, heroBottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: 210, backgroundColor: "rgba(0,0,0,.46)" },
  heroFloatingHeader: { position: "absolute", left: 18, right: 18, top: 18, flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  heroEyebrow: { color: palette.lime, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.2 }, heroTitle: { color: palette.white, maxWidth: 260, fontSize: 27, lineHeight: 30, marginTop: 5, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) },
  lockButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 16, backgroundColor: "rgba(255,255,255,.16)" }, lockButtonActive: { backgroundColor: palette.gold }, lockButtonText: { color: palette.white, fontSize: 6.5, fontWeight: "900" }, lockButtonTextActive: { color: palette.ink },
  heroCaption: { position: "absolute", left: 18, right: 18, bottom: 18 }, heroRationale: { color: palette.white, fontSize: 10, lineHeight: 15, fontWeight: "600" },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 9 }, signalPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: "rgba(255,255,255,.14)" }, signalText: { color: palette.white, fontSize: 6.5, fontWeight: "800" },
  signalPillLight: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, backgroundColor: palette.smoke }, signalTextDark: { color: palette.ink, fontSize: 6.5, fontWeight: "800" },
  heroActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionButton: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 17, borderWidth: 1, borderColor: palette.ink, backgroundColor: palette.white }, actionButtonPrimary: { borderColor: palette.cobalt, backgroundColor: palette.cobalt }, actionButtonText: { color: palette.ink, fontSize: 7.5, fontWeight: "900", letterSpacing: .4 }, actionButtonTextPrimary: { color: palette.white }, disabled: { opacity: .4 },
  renderOverlay: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 45, backgroundColor: "rgba(8,10,15,.78)" }, renderOrb: { width: 64, height: 64, alignItems: "center", justifyContent: "center", borderRadius: 32, borderWidth: 1, borderColor: palette.lime, backgroundColor: "rgba(199,255,86,.12)" }, renderOrbText: { color: palette.lime, fontSize: 28, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) }, renderTitle: { color: palette.white, fontSize: 15, fontWeight: "900", textAlign: "center", marginTop: 16 }, renderCopy: { color: "#AEB4BF", fontSize: 8, lineHeight: 13, textAlign: "center", marginTop: 7 },
  planPicker: { gap: 8, paddingHorizontal: 16, paddingBottom: 16 }, planModeCard: { width: 150, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white }, planModeCardActive: { borderColor: palette.cobalt, backgroundColor: palette.cobalt }, planModeEyebrow: { color: palette.cobalt, fontSize: 6.5, fontWeight: "900", letterSpacing: .8 }, planModeEyebrowActive: { color: palette.lime }, planModeScore: { color: palette.ink, fontSize: 30, fontWeight: "900", marginTop: 8 }, planModeScoreActive: { color: palette.white }, planModeMeta: { color: palette.muted, fontSize: 6.5, marginTop: 5 }, planModeMetaActive: { color: "#C9D2FF" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginHorizontal: 16, marginBottom: 18 }, metricCard: { width: "48.8%", padding: 15, borderRadius: 18, backgroundColor: palette.white }, metricValue: { color: palette.ink, fontSize: 25, fontWeight: "900" }, metricLabel: { color: palette.muted, fontSize: 6, fontWeight: "900", letterSpacing: .8, marginTop: 4 },
  compareRoot: { position: "relative", height: 500, marginHorizontal: 16, overflow: "hidden", borderRadius: 26, backgroundColor: palette.ink }, compareImage: { position: "absolute", left: 0, top: 0, height: "100%", width: "100%" }, compareClip: { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" }, compareLine: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: palette.lime }, compareHandle: { position: "absolute", top: "50%", left: -18, width: 38, height: 38, marginTop: -19, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: palette.lime }, compareHandleText: { color: palette.ink, fontSize: 14, fontWeight: "900" }, compareLabels: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", justifyContent: "space-between" }, compareLabel: { color: palette.white, fontSize: 7, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: "rgba(0,0,0,.55)" },
  candidateCard: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 22, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.white }, candidateCardSelected: { borderColor: palette.cobalt, shadowColor: palette.cobalt, shadowOpacity: .12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }, candidateHeader: { flexDirection: "row", alignItems: "center" }, candidateEyebrow: { color: palette.cobalt, fontSize: 6.5, fontWeight: "900", letterSpacing: .8 }, candidateName: { color: palette.ink, fontSize: 20, fontWeight: "900", marginTop: 4 }, candidateArrow: { color: palette.muted, fontSize: 25 }, candidateRationale: { color: palette.muted, fontSize: 8, lineHeight: 13, marginTop: 11 }, candidateFooter: { flexDirection: "row", alignItems: "flex-end", gap: 8 }, smallRenderButton: { marginLeft: "auto", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 15, backgroundColor: palette.ink }, smallRenderText: { color: palette.lime, fontSize: 6.5, fontWeight: "900" },
  garmentStrip: { gap: 7, paddingVertical: 11 }, garmentChip: { width: 100, height: 68, justifyContent: "center", paddingHorizontal: 10, borderRadius: 14, backgroundColor: palette.paper }, garmentChipSlot: { color: palette.cobalt, fontSize: 5.5, fontWeight: "900", textTransform: "uppercase" }, garmentChipName: { color: palette.ink, fontSize: 8, fontWeight: "800", marginTop: 4 }, garmentChipColor: { color: palette.muted, fontSize: 6, marginTop: 3 },
  briefCard: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 24, backgroundColor: palette.white }, sectionEyebrow: { color: palette.cobalt, fontSize: 6.5, fontWeight: "900", letterSpacing: 1.1 }, sectionTitle: { color: palette.ink, fontSize: 25, lineHeight: 28, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), marginTop: 4 }, choiceSection: { marginTop: 18 }, choiceLabel: { color: palette.muted, fontSize: 6, fontWeight: "900", letterSpacing: .9, marginBottom: 7 }, choiceRow: { gap: 6 }, choicePill: { paddingHorizontal: 11, paddingVertical: 9, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.paper }, choicePillActive: { borderColor: palette.ink, backgroundColor: palette.ink }, choicePillText: { color: palette.muted, fontSize: 7.5, fontWeight: "800" }, choicePillTextActive: { color: palette.lime },
  dnaPanel: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 24, backgroundColor: palette.ink }, dnaHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }, dnaActions: { color: palette.lime, fontSize: 7, fontWeight: "900", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: "rgba(199,255,86,.12)" }, dnaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }, dnaLabel: { width: 58, color: palette.white, fontSize: 7.5, fontWeight: "700" }, dnaTrack: { flex: 1, height: 6, overflow: "hidden", borderRadius: 3, backgroundColor: "#2B2F38" }, dnaFill: { height: 6, borderRadius: 3, backgroundColor: palette.lime }, dnaValue: { width: 24, color: "#AEB4BF", fontSize: 7, textAlign: "right" },
  graphPanel: { marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 24, backgroundColor: palette.white }, graphHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }, inlineLink: { color: palette.cobalt, fontSize: 6.5, fontWeight: "900", paddingVertical: 8 }, graphMetrics: { flexDirection: "row", gap: 7, marginTop: 17 }, graphMetric: { flex: 1, padding: 11, borderRadius: 14, backgroundColor: palette.paper }, graphMetricValue: { color: palette.ink, fontSize: 18, fontWeight: "900" }, graphMetricLabel: { color: palette.muted, fontSize: 5.3, fontWeight: "900", marginTop: 3 }, graphSubtitle: { color: palette.muted, fontSize: 6, fontWeight: "900", letterSpacing: .9, marginTop: 18, marginBottom: 10 }, heroNodeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }, heroNodeRank: { width: 20, color: palette.cobalt, fontSize: 7, fontWeight: "900" }, heroNodeTrack: { flex: 1, height: 9, overflow: "hidden", borderRadius: 5, backgroundColor: palette.smoke }, heroNodeFill: { height: 9, borderRadius: 5, backgroundColor: palette.cobalt }, heroNodeValue: { width: 24, color: palette.ink, fontSize: 7, fontWeight: "900", textAlign: "right" }, graphGap: { marginTop: 14, padding: 13, borderRadius: 15, backgroundColor: palette.limeSoft }, graphGapLabel: { color: palette.success, fontSize: 5.8, fontWeight: "900", letterSpacing: .8 }, graphGapText: { color: palette.ink, fontSize: 8, lineHeight: 13, marginTop: 5 },
  queueTray: { marginHorizontal: 16, marginBottom: 16, padding: 16, borderRadius: 22, backgroundColor: palette.white }, queueRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, queueDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: palette.cobalt }, queueDotReady: { borderColor: palette.success, backgroundColor: palette.success }, queueDotFailed: { borderColor: palette.danger, backgroundColor: palette.danger }, queueTitle: { color: palette.ink, fontSize: 8.5, fontWeight: "800" }, queueMeta: { color: palette.muted, fontSize: 6.5, marginTop: 3 }, queueRetry: { color: palette.danger, fontSize: 6, fontWeight: "900" },
  connectionScreen: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, paddingBottom: 90 }, connectionMark: { width: 84, height: 84, alignItems: "center", justifyContent: "center", borderRadius: 28, backgroundColor: palette.ink }, connectionMarkText: { color: palette.lime, fontSize: 42, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }) }, connectionTitle: { color: palette.ink, fontSize: 27, lineHeight: 30, fontWeight: "900", textAlign: "center", marginTop: 24 }, connectionCopy: { color: palette.muted, fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 10, marginBottom: 24 },
});
