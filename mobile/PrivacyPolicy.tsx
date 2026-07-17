import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export const privacyPolicyUrl = "https://vesta-armario-alan.alangael2411.chatgpt.site/privacidad";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const sections = [
  {
    title: "1. Datos que tratamos",
    body: "Podemos tratar el identificador de tu cuenta y dispositivo; las fotos que eliges; tu avatar; imágenes y descripciones de prendas; Looks, fechas que agregas al calendario y preferencias; enlaces públicos de productos que importas; estado y referencias técnicas de suscripciones; y datos técnicos necesarios para seguridad, diagnóstico y funcionamiento.",
  },
  {
    title: "2. Cómo usamos tus datos",
    body: "Los usamos para crear y sincronizar tu armario privado, detectar prendas, generar imágenes de prueba virtual, guardar Looks, programarlos en tu calendario interno, importar productos, restaurar compras, proteger el acceso y resolver errores. No vendemos tus datos ni los usamos para publicidad dirigida.",
  },
  {
    title: "3. Fotos, avatar e inteligencia artificial",
    body: "Outfit Club solo accede a las fotos que seleccionas. Cuando solicitas análisis, un avatar o un Look, enviamos a OpenAI únicamente las imágenes necesarias desde la infraestructura de Outfit Club. No pedimos ni guardamos credenciales personales de ChatGPT. Las referencias de selfie y cuerpo completo no se conservan después de crear el avatar. OpenAI puede conservar registros de seguridad según su política aplicable.",
  },
  {
    title: "4. Proveedores",
    body: "Usamos infraestructura de Cloudflare para base de datos, almacenamiento y entrega privada; OpenAI para funciones de análisis o generación que tú inicias; y Apple para pagos, suscripciones y distribución. Cada proveedor trata únicamente los datos necesarios para prestar su servicio y se rige por sus propios términos.",
  },
  {
    title: "5. Conservación y eliminación",
    body: "Conservamos el armario, avatar, prendas y Looks mientras mantengas tu cuenta o hasta que los elimines. Puedes borrar prendas y Looks individualmente. Desde Perfil puedes eliminar el avatar o eliminar definitivamente la cuenta completa; esta última acción borra los datos de la nube y las copias privadas de la app en el dispositivo. Eliminar la cuenta no cancela automáticamente una suscripción administrada por Apple.",
  },
  {
    title: "6. Seguridad y transferencias",
    body: "Aplicamos acceso por cuenta y dispositivo, conexiones cifradas y almacenamiento privado. Ningún sistema es infalible. Los proveedores pueden procesar información en Estados Unidos u otros países donde operan, con las salvaguardas aplicables.",
  },
  {
    title: "7. Tus opciones y derechos",
    body: "Puedes retirar el permiso de Fotos desde Ajustes de iOS, administrar o cancelar tu suscripción con Apple, borrar contenidos individuales y eliminar tu cuenta desde Perfil. También puedes solicitar acceso o corrección mediante el canal de soporte. Retirar un permiso puede impedir que ciertas funciones operen.",
  },
  {
    title: "8. Menores y cambios",
    body: "Outfit Club no está dirigida a menores de 13 años. Podemos actualizar esta política cuando cambien el producto o las obligaciones legales; publicaremos la fecha de la versión vigente.",
  },
];

export function PrivacyPolicyModal({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>OUTFIT CLUB</Text>
            <Text style={styles.headerTitle}>Privacidad</Text>
          </View>
          <Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Cerrar política de privacidad">
            <Text style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Tu ropa y tus fotos siguen siendo tuyas.</Text>
          <Text style={styles.updated}>Vigente desde el 15 de julio de 2026</Text>
          <Text style={styles.lead}>Esta política explica cómo Outfit Club trata la información cuando utilizas la aplicación móvil y su nube privada.</Text>
          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.body}>{section.body}</Text>
            </View>
          ))}
          <View style={styles.contactCard}>
            <Text style={styles.sectionTitle}>Contacto de privacidad</Text>
            <Text style={styles.body}>Responsable: Outfit Club. Para consultas o solicitudes, usa el enlace de soporte publicado en la ficha de Outfit Club en App Store.</Text>
            <Pressable onPress={() => Linking.openURL(privacyPolicyUrl).catch(() => undefined)}>
              <Text style={styles.webLink}>Abrir versión web de esta política</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E5E5" },
  eyebrow: { color: "#A34F31", fontSize: 7, fontWeight: "900", letterSpacing: 1.3 },
  headerTitle: { color: "#211F1B", fontSize: 20, fontWeight: "800", marginTop: 3 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.62)" },
  closeText: { color: "#211F1B", fontSize: 25, fontWeight: "300" },
  content: { paddingHorizontal: 22, paddingTop: 30, paddingBottom: 50 },
  title: { color: "#211F1B", fontSize: 34, lineHeight: 39, letterSpacing: -1.1, fontFamily: "Georgia" },
  updated: { color: "#A34F31", fontSize: 8, fontWeight: "800", letterSpacing: .5, marginTop: 13 },
  lead: { color: "#655F55", fontSize: 11, lineHeight: 18, marginTop: 14, marginBottom: 8 },
  section: { paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#D8D1C4" },
  sectionTitle: { color: "#211F1B", fontSize: 12, lineHeight: 17, fontWeight: "900" },
  body: { color: "#655F55", fontSize: 10, lineHeight: 17, marginTop: 8 },
  contactCard: { marginTop: 22, padding: 17, borderRadius: 16, backgroundColor: "#F7F7F7", borderWidth: 1, borderColor: "#E5E5E5" },
  webLink: { color: "#A34F31", fontSize: 9, lineHeight: 14, fontWeight: "900", textDecorationLine: "underline", marginTop: 13 },
});
