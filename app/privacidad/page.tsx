import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad — Outfit Club",
  description: "Cómo Outfit Club protege y trata tus fotos, prendas, avatar, Looks y datos de suscripción.",
};

const sections = [
  ["1. Datos que tratamos", "Podemos tratar el identificador de tu cuenta y dispositivo; las fotos que eliges; tu avatar; imágenes y descripciones de prendas; Looks, fechas que agregas al calendario y preferencias; enlaces públicos de productos que importas; estado y referencias técnicas de suscripciones; y datos técnicos necesarios para seguridad, diagnóstico y funcionamiento."],
  ["2. Finalidades", "Usamos esos datos para crear y sincronizar tu armario privado, detectar prendas, generar imágenes de prueba virtual, guardar Looks, programarlos en tu calendario interno, importar productos, restaurar compras, proteger el acceso y resolver errores. No vendemos tus datos ni los utilizamos para publicidad dirigida."],
  ["3. Fotos, avatar e inteligencia artificial", "Outfit Club solo accede a las fotos que seleccionas. Cuando solicitas análisis, un avatar o un Look, enviamos a OpenAI únicamente las imágenes necesarias desde la infraestructura de Outfit Club. No pedimos ni guardamos credenciales personales de ChatGPT. Las referencias de selfie y cuerpo completo no se conservan después de crear el avatar. OpenAI puede conservar registros de seguridad según su política aplicable."],
  ["4. Proveedores", "Usamos infraestructura de Cloudflare para base de datos, almacenamiento y entrega privada; OpenAI para funciones de análisis o generación que tú inicias; y Apple para pagos, suscripciones y distribución. Cada proveedor trata únicamente los datos necesarios para prestar su servicio y se rige por sus propios términos."],
  ["5. Conservación y eliminación", "Conservamos el armario, avatar, prendas y Looks mientras mantengas tu cuenta o hasta que los elimines. Puedes borrar prendas y Looks individualmente. Desde Perfil puedes eliminar el avatar o eliminar definitivamente la cuenta completa; esta última acción borra los datos de la nube y las copias privadas de la app en el dispositivo. Eliminar la cuenta no cancela automáticamente una suscripción administrada por Apple."],
  ["6. Seguridad y transferencias", "Aplicamos acceso por cuenta y dispositivo, conexiones cifradas y almacenamiento privado. Ningún sistema es infalible. Los proveedores pueden procesar información en Estados Unidos u otros países donde operan, con las salvaguardas aplicables."],
  ["7. Tus opciones y derechos", "Puedes retirar el permiso de Fotos desde Ajustes de iOS, administrar o cancelar tu suscripción con Apple, borrar contenidos individuales y eliminar tu cuenta desde Perfil. También puedes solicitar acceso o corrección mediante el canal de soporte. Retirar un permiso puede impedir que ciertas funciones operen."],
  ["8. Menores y cambios", "Outfit Club no está dirigida a menores de 13 años. Podemos actualizar esta política cuando cambien el producto o las obligaciones legales; publicaremos aquí la fecha de la versión vigente."],
];

export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <header className="privacy-page-header">
        <Link href="/" className="privacy-brand" aria-label="Volver a Outfit Club"><span>OC</span> OUTFIT CLUB</Link>
        <span className="privacy-badge">CUENTA PROTEGIDA</span>
      </header>
      <article className="privacy-document">
        <p className="privacy-eyebrow">POLÍTICA DE PRIVACIDAD</p>
        <h1>Tu ropa y tus fotos siguen siendo tuyas.</h1>
        <p className="privacy-date">Vigente desde el 15 de julio de 2026</p>
        <p className="privacy-lead">Esta política explica cómo Outfit Club trata la información cuando utilizas la aplicación móvil y su nube privada.</p>
        {sections.map(([title, body]) => (
          <section key={title}>
            <h2>{title}</h2>
            <p>{body}</p>
          </section>
        ))}
        <aside className="privacy-contact">
          <h2>Contacto de privacidad</h2>
          <p><strong>Responsable: Outfit Club.</strong> Para consultas o solicitudes de acceso, corrección o eliminación, utiliza el enlace de soporte publicado en la ficha de Outfit Club en App Store.</p>
        </aside>
      </article>
    </main>
  );
}
