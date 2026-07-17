import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;

  return {
    title: "Vesta — tu armario, entendido",
    description: "Convierte las prendas que ya tienes en decisiones claras: qué ponerte, por qué funciona y qué merece volver a rotación.",
    manifest: "/manifest.webmanifest",
    applicationName: "Vesta",
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Vesta" },
    formatDetection: { telephone: false },
    icons: {
      icon: [
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    },
    openGraph: {
      title: "Vesta — tu armario, entendido",
      description: "Tu armario convertido en decisiones claras, personales y explicables.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Vesta, inteligencia para tu armario" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vesta — tu armario, entendido",
      description: "Tu armario convertido en decisiones claras, personales y explicables.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f0e7",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
