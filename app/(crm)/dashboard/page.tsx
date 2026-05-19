import type { Metadata } from "next";
import { Calendar, Users, FileText, Wrench, Clock } from "lucide-react";
import StatCard from "@/components/ui/StatCard";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Dashboard" };

// Dati mock — in Fase 4 saranno query Firestore server-side
const stats = [
  { label: "Appuntamenti oggi",   value: 6,   sub: "2 completati",     icon: <Calendar size={22} />, accent: "#FFC803" },
  { label: "Preventivi aperti",   value: 14,  sub: "3 in scadenza",    icon: <FileText size={22} />, accent: "#249689" },
  { label: "Fogli lavoro attivi", value: 4,   sub: "1 in lavorazione", icon: <Wrench size={22} />,   accent: "#EE8B60" },
  { label: "Clienti totali",      value: 312, sub: "+5 questo mese",   icon: <Users size={22} />,    accent: "#3B82F6" },
];

const appuntamenti = [
  { ora: "08:30", cliente: "Mario Rossi",    targa: "AB123CD", servizio: "Cambio gomme",     stato: "completato" },
  { ora: "09:00", cliente: "Luigi Bianchi",  targa: "EF456GH", servizio: "Bilanciatura",      stato: "completato" },
  { ora: "10:30", cliente: "Anna Verdi",     targa: "IJ789KL", servizio: "Convergenza",       stato: "in_corso" },
  { ora: "12:00", cliente: "Carlo Esposito", targa: "MN012OP", servizio: "Cambio gomme",     stato: "programmato" },
  { ora: "14:30", cliente: "Sara Romano",    targa: "QR345ST", servizio: "Revisione",         stato: "programmato" },
  { ora: "16:00", cliente: "Pino Ferrara",   targa: "UV678WX", servizio: "Cambio gomme",     stato: "programmato" },
];

const statoVariant: Record<string, "success" | "brand" | "neutral"> = {
  completato: "success",
  in_corso: "brand",
  programmato: "neutral",
};
const statoLabel: Record<string, string> = {
  completato: "Completato",
  in_corso: "In corso",
  programmato: "Programmato",
};

export default function DashboardPage() {
  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}>
          Dashboard
        </h1>
        <p className="text-sm mt-1 capitalize" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
          {today}
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      {/* Appuntamenti oggi */}
      <Card>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-base" style={{ fontFamily: "var(--font-poppins)" }}>
            Appuntamenti di oggi
          </h2>
          <button
            className="text-xs font-semibold px-4 py-1.5 rounded-full transition-colors"
            style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
          >
            + Nuovo
          </button>
        </div>
        <div className="space-y-2">
          {appuntamenti.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3 rounded-xl transition-colors hover:bg-[#F1F4F8] cursor-pointer"
            >
              <div className="flex items-center gap-1.5 w-14 flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                <Clock size={13} />
                <span className="text-xs font-medium" style={{ fontFamily: "var(--font-montserrat)" }}>{a.ora}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ fontFamily: "var(--font-montserrat)" }}>{a.cliente}</p>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{a.servizio} · {a.targa}</p>
              </div>
              <Badge variant={statoVariant[a.stato]}>{statoLabel[a.stato]}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
