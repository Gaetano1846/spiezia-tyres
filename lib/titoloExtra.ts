// Segnali che vivono SOLO nel testo libero del titolo prodotto (campo
// `titolo`/`Titolo`/`Nome` a seconda della pagina) — nessuna colonna
// strutturata su public.prodotti li contiene: costruzione ZR, marcatura
// Run-Flat, codici OE tra parentesi. Estratti via regex dal testo import
// (fornitori diversi, spaziatura/maiuscole incoerenti) — copre la
// stragrande maggioranza dei titoli reali ma non è garantito al 100% sugli
// outlier più esotici.

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "ZR" se il titolo marca il diametro come costruzione Z (es. "245/40 ZR20 99Y"), altrimenti "R". */
export function speedConstructionPrefix(
  titolo: string | null | undefined,
  diametro: number | string | null | undefined
): "ZR" | "R" {
  if (!titolo || diametro == null || diametro === "") return "R";
  const re = new RegExp(`ZR\\s?${escapeRegex(String(diametro))}\\b`, "i");
  return re.test(titolo) ? "ZR" : "R";
}

// "R/F", "RF", "R-F", "r-f"... — le varianti con cui i fornitori marcano il Run-Flat.
const RUNFLAT_RE = /\bR[\s\-/]?F\b/i;

export function isRunFlat(titolo: string | null | undefined): boolean {
  return !!titolo && RUNFLAT_RE.test(titolo);
}

const PAREN_RE = /\(([^)]+)\)/g;

/** Tutti i codici tra parentesi nel titolo (OE, generazione compound, anno...), nell'ordine in cui compaiono. */
export function parenthesizedCodes(titolo: string | null | undefined): string[] {
  if (!titolo) return [];
  return [...titolo.matchAll(PAREN_RE)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Codici tra parentesi da mostrare accanto al Modello — esclude quelli già
 * presenti nel Modello stesso (alcuni modelli, es. "P-ZERO (PZ5)", incorporano
 * già il proprio codice generazione: senza questo filtro comparirebbe due volte).
 */
export function extraOeCodes(titolo: string | null | undefined, modello: string | null | undefined): string[] {
  const codes = parenthesizedCodes(titolo);
  if (!modello) return codes;
  return codes.filter((c) => !modello.includes(c));
}
