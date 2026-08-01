// Icona + colori stagione condivisi tra /prodotti (riga risultati e filtri)
// e la home (widget di ricerca) — prima la home usava emoji (🔥/⚙️/❄️),
// diverse dalle icone lucide della riga prodotti: unificate su richiesta
// utente per coerenza visiva tra le due pagine.
import { Snowflake, Sun, Wind } from "lucide-react";

export type Stagione = "Estive" | "Invernali" | "4 Stagioni";

export const STAGIONE_COLORS: Record<Stagione, { active: string; text: string; icon: string }> = {
  Estive:       { active: "#FFC803", text: "#111", icon: "#EAB308" },
  Invernali:    { active: "#2563EB", text: "#fff", icon: "#2563EB" },
  "4 Stagioni": { active: "#16A34A", text: "#fff", icon: "#16A34A" },
};

export function StagioneIcon({ stagione, size = 16 }: { stagione: string; size?: number }) {
  if (stagione === "Invernali")
    return <Snowflake size={size} style={{ color: STAGIONE_COLORS.Invernali.icon }} />;
  if (stagione === "4 Stagioni")
    return <Wind size={size} style={{ color: STAGIONE_COLORS["4 Stagioni"].icon }} />;
  return <Sun size={size} style={{ color: STAGIONE_COLORS.Estive.icon }} />;
}
