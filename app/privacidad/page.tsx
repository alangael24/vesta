import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad — Outfit Club",
  description: "Cómo Outfit Club protege y trata tus fotos, prendas, avatar, Looks y datos de suscripción.",
};

const sections = [
  ["1. Datos que tratamos", "Podemos tratar el identificador de tu cuenta y dispositivo; las fotos que eliges; tu avatar; imágenes y descripciones de prendas; Looks y preferencias; enlaces públicos de productos que importas; estado y referencias técnicas de suscripciones; y datos técnicos necesarios para seguridad, diagnóstico y funcionamiento."],
  ["2. Finalidades", "Usamos esos datos para crear y sincronizar tu armario privado, detectar prendas, generar imágenes de prueba virtual, guardar Looks, importar productos, restaurar compras, proteger el acceso y resolver errores. No vendemos tus datos ni los utilizamos para publicidad dirigida."],
  ["3. Fotos, avatar e inteligencia artificial", "Outfit Club solo accede a las fotos que seleccionas. Cuando solicitas análisis o generación, las imágenes necesarias pueden enviarse a OpenAI después de mostrarte el aviso correspondiente. En el modo experimental con ChatGPT, los tokens se guardan en el Keychain del iPhone y no pasan por la nube de Outfit Club. OpenAI puede conservar registros de seguridad según sus propias políticas y la modalidad utilizada."],
  ["4. Proveedores", "Usamos infraestructura de Cloudflare para base de datos, almacenamiento y entrega privada; OpenAI para funciones de análisis o generación que tú inicias; y Apple para pagos, suscripciones y distribución. Cada proveedor trata únicamente los datos necesarios para prestar su servicio y se rige por sus propios términos."],
  ["5. Conservación y eliminación", "Conservamos el armario, avatar, prendas y Looks mientras mantengas tu cuenta o hasta que los elimines. Las copias locales permanecen en tu dispositivo. Puedes eliminar el avatar desde Perfil y borrar selecciones antes de subirlas. Para eliminar otros datos o solicitar la eliminación completa de la cuenta, utiliza el canal de soporte publicado en la ficha de Outfit Club en App Store."],
  ["6. Seguridad y transferencias", "Aplicamos acceso por cuenta y dispositivo, conexiones cifradas y almacenamiento privado. Ningún sistema es infalible. Los proveedores pueden procesar información en Estados Unidos u otros países donde operan, con las salvaguardas aplicables."],
  ["7. Tus opciones y derechos", "Puedes retirar permisos de Fotos desde Ajustes de iOS, desconectar ChatGPT, administrar tu suscripción con Apple y solicitar acceso, corrección o eliminación de tus datos mediante el canal de soporte. Retirar un permiso puede impedir que ciertas funciones operen."],
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
