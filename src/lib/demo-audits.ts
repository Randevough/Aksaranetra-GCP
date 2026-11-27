import type { AuditResult } from "./audit-api";
import pemprovSulselDemo from "../../public/data/demo/pemprov-sulsel-demo.json";
import portalAkademikDemo from "../../public/data/demo/portal-akademik-demo.json";

export interface DemoAuditPreset {
  slug: string;
  label: string;
  domain: string;
  description: string;
}

export const DEMO_AUDITS: DemoAuditPreset[] = [
  {
    slug: "pemprov-sulsel-demo",
    label: "Demo: Portal Pemprov Sulsel",
    domain: "sulselprov.go.id",
    description:
      "Contoh audit portal pemerintah daerah lengkap dengan skor, pin temuan, alur fokus keyboard, dan peta regulasi.",
  },
  {
    slug: "portal-akademik-demo",
    label: "Demo: Portal Akademik Kampus",
    domain: "siakad.contoh-kampus.ac.id",
    description:
      "Contoh audit sistem informasi akademik (form pencarian, tabel KRS, dan kontras peringatan).",
  },
];

const DEMO_MAP: Record<string, AuditResult> = {
  "pemprov-sulsel-demo": pemprovSulselDemo as AuditResult,
  "portal-akademik-demo": portalAkademikDemo as AuditResult,
};

export function getDemoAudit(slug: string): AuditResult | null {
  return DEMO_MAP[slug] ?? null;
}
