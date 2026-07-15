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
    title: "Vesta — tu armario, mejor combinado",
    description: "Organiza tu ropa desde tus fotos y descubre nuevos looks con lo que ya tienes.",
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
      title: "Vesta — tu armario, mejor combinado",
      description: "Organiza tu ropa y descubre nuevos looks con lo que ya tienes.",
      type: "website",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "Vesta, armario inteligente" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Vesta — tu armario, mejor combinado",
      description: "Organiza tu ropa y descubre nuevos looks con lo que ya tienes.",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f3efe5",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
