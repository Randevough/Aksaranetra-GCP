import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import NotificationBar from "@/components/NotificationBar";
import ViewportBlur from "@/components/ViewportBlur";
import BlueGlow from "@/components/BlueGlow";
import MotionProvider from "@/components/MotionProvider";

export const metadata: Metadata = {
  title: {
    default: "AksaraNetra | Aksesibilitas Digital Indonesia",
    template: "%s | AksaraNetra",
  },
  description:
    "Periksa hambatan aksesibilitas pada halaman publik, uji perbaikan yang aman, dan siapkan tampilan reader tanpa mengubah situs asli.",
  openGraph: {
    title: "AksaraNetra",
    description:
      "Pemeriksaan aksesibilitas untuk halaman publik dengan hasil yang dapat ditinjau.",
    type: "website",
    locale: "id_ID",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" data-scroll-behavior="smooth">
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
