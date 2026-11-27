import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import NotificationBar from "@/components/NotificationBar";
import ViewportBlur from "@/components/ViewportBlur";
import BlueGlow from "@/components/BlueGlow";
import MotionProvider from "@/components/MotionProvider";

const plusJakartaSans = Plus_Jakarta_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-plus-jakarta-sans",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "https://aksaranetra.rafifernanda.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AksaraNetra | Aksesibilitas Digital Indonesia",
    template: "%s | AksaraNetra",
  },
  description:
    "Periksa hambatan aksesibilitas pada halaman publik, uji perbaikan yang aman, dan siapkan tampilan reader tanpa mengubah situs asli.",
  keywords: [
    "AksaraNetra",
    "aksesibilitas digital Indonesia",
    "audit aksesibilitas web",
    "WCAG 2.1",
    "WCAG 2.2",
    "pembaca layar",
    "web reader aksesibel",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "AksaraNetra | Aksesibilitas Digital Indonesia",
    description:
      "Pemeriksaan aksesibilitas untuk halaman publik dengan hasil yang dapat ditinjau.",
    url: "/",
    siteName: "AksaraNetra",
    type: "website",
    locale: "id_ID",
    images: [
      {
        url: "/preview-ringkasan.png",
        width: 1200,
        height: 630,
        alt: "Pratinjau hasil pemeriksaan AksaraNetra",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AksaraNetra | Aksesibilitas Digital Indonesia",
    description:
      "Periksa hambatan aksesibilitas pada halaman publik, uji perbaikan yang aman, dan siapkan tampilan reader tanpa mengubah situs asli.",
    images: ["/preview-ringkasan.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={plusJakartaSans.variable}
      data-scroll-behavior="smooth"
    >
      <body suppressHydrationWarning>
        <MotionProvider>
          <a href="#main-content" className="skip-link">
            Langsung ke konten utama
          </a>
          <BlueGlow variant="global" />
          <ViewportBlur />
          <Header />
          <div id="main-content" tabIndex={-1}>
            {children}
          </div>
          <Footer />
          <NotificationBar />
        </MotionProvider>
      </body>
    </html>
  );
}
