// Icona + colori stagione condivisi tra /prodotti (riga risultati e filtri)
// e la home (widget di ricerca) — prima la home usava emoji (🔥/⚙️/❄️),
// diverse dalle icone lucide della riga prodotti: unificate su richiesta
// utente per coerenza visiva tra le due pagine.
// "4 Stagioni": SunSnow invece di Wind (che non comunicava "tutte le stagioni")
// — icona lucide dedicata che unisce sole+fiocco di neve in un'unica forma.
import { Snowflake, Sun, SunSnow } from "lucide-react";

export type Stagione = "Estive" | "Invernali" | "4 Stagioni";

export const STAGIONE_COLORS: Record<Stagione, { active: string; text: string; icon: string }> = {
  Estive:       { active: "#FFC803", text: "#111", icon: "#EAB308" },
  Invernali:    { active: "#2563EB", text: "#fff", icon: "#2563EB" },
  "4 Stagioni": { active: "#16A34A", text: "#fff", icon: "#16A34A" },
};

export function StagioneIcon({ stagione, size = 16 }: { stagione: string; size?: number }) {
  if (stagione === "Invernali")
    return <Snowflake size={size} style={{ color: STAGIONE_COLORS.Invernali.icon }} />;
  if (stagione === "4 Stagioni") {
    // I tratti di SunSnow sono già disegnati metà-sole (sinistra) / metà-fiocco
    // (destra): due copie clippate al 50% colorate diversamente danno il
    // sole giallo + neve blu richiesto, senza dover ridisegnare l'icona.
    return (
      <span style={{ position: "relative", display: "inline-block", width: size, height: size }}>
        <SunSnow size={size} style={{ position: "absolute", inset: 0, color: STAGIONE_COLORS.Estive.icon, clipPath: "inset(0 50% 0 0)" }} />
        <SunSnow size={size} style={{ position: "absolute", inset: 0, color: STAGIONE_COLORS.Invernali.icon, clipPath: "inset(0 0 0 50%)" }} />
      </span>
    );
  }
  return <Sun size={size} style={{ color: STAGIONE_COLORS.Estive.icon }} />;
}
