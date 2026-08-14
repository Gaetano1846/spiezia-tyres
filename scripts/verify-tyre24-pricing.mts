// Verifica standalone delle funzioni pure di lib/tyre24/pricing.ts —
// nessun framework di test in questo repo (vedi package.json), pattern
// coerente con gli script .mjs di verifica già usati altrove (Spiezia-DB).
// Esegui con: node --experimental-strip-types scripts/verify-tyre24-pricing.mts

import { needsLevel2, buildRanking, suggestPrice, suggestPriceFromEk, computePav } from "../lib/tyre24/pricing.ts";

let ok = 0;
let fail = 0;

function assert(desc: string, actual: unknown, expected: unknown): void {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    ok++;
    console.log(`OK   ${desc}`);
  } else {
    fail++;
    console.log(`FAIL ${desc} — atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}

// ─── needsLevel2 ────────────────────────────────────────────────────────────
// Numeri reali di questa sessione: CAI 313048000, ek=75 a minStock=1 (in
// realtà il NOSTRO prezzo), ek=73.16 a minStock=4 (il vero prezzo più basso,
// confermato sul sito Tyre24: E-Tyre a 73,16€).

assert(
  "battuti (ek < prezzo attuale) -> niente livello2, a prescindere dalla soglia",
  needsLevel2({ prezzoAttuale: 75, ekStimato: 73.16, sogliaPct: 0.05 }),
  false
);
assert(
  // Bug segnalato in produzione il 2026-08-14: quando siamo già primi, /search
  // trova NOI STESSI come "offerta più economica" -> ekStimato ~= prezzoAttuale
  // -> delta ~0. Questo DEVE far scattare il livello 2 (altrimenti non si
  // scopre mai il 2° classificato e non si sa se conviene alzare il prezzo).
  "pareggio esatto (ek === prezzo, delta 0) -> livello2 (siamo noi stessi trovati da /search)",
  needsLevel2({ prezzoAttuale: 75, ekStimato: 75, sogliaPct: 0.05 }),
  true
);
assert(
  "già i più economici, scarto piccolo entro soglia (<=5%) -> livello2 (probabile pareggio con noi stessi)",
  needsLevel2({ prezzoAttuale: 70, ekStimato: 73.16, sogliaPct: 0.05 }), // delta ~4.5% <= 5%
  true
);
assert(
  "già i più economici, scarto grande oltre soglia (>3%) -> niente livello2 (scarto troppo anomalo per fidarsi, si resta prudenti)",
  needsLevel2({ prezzoAttuale: 70, ekStimato: 73.16, sogliaPct: 0.03 }), // delta ~4.5% > 3%
  false
);
assert("nessuna stima (ekStimato null) -> niente livello2", needsLevel2({ prezzoAttuale: 75, ekStimato: null, sogliaPct: 0.05 }), false);
assert("nessun prezzo di riferimento (null) -> livello2 sempre", needsLevel2({ prezzoAttuale: null, ekStimato: 75, sogliaPct: 0.05 }), true);
assert("prezzo di riferimento 0 -> livello2 sempre", needsLevel2({ prezzoAttuale: 0, ekStimato: 75, sogliaPct: 0.05 }), true);

// ─── buildRanking ───────────────────────────────────────────────────────────

const distributoriConNoi = [
  { name: "Spiezia Tyres S.p.A.", stock: 20, priceList: [{ type: "ek", value: 75 }] },
  { name: "EuroMontyres S.L.", stock: 25, priceList: [{ type: "ek", value: 74.85 }] },
  { name: "Tiresur S.L.", stock: 25, priceList: [{ type: "ek", value: 74.9 }] },
  { name: "Basso Stock GmbH", stock: 1, priceList: [{ type: "ek", value: 60 }] }, // sotto minStock=4, escluso col fallback
];

{
  const r = buildRanking(distributoriConNoi, 4);
  assert("buildRanking: best = EuroMontyres (74.85, il più economico reale)", r.best?.name, "EuroMontyres S.L.");
  assert("buildRanking: second = Tiresur (74.90)", r.second?.name, "Tiresur S.L.");
  assert("buildRanking: nostraPos = 3 (dietro EuroMontyres e Tiresur)", r.nostraPos, 3);
  assert("buildRanking: nostroStock = 20", r.nostroStock, 20);
  assert("buildRanking: Basso Stock GmbH escluso (sotto minStock, ma con fallback presente altrove)", r.ranking.some((d) => d.name === "Basso Stock GmbH"), false);
}

{
  // Fallback: TUTTI sotto minStock -> usa la lista intera invece di vuota.
  const soloBassoStock = [{ name: "Basso Stock GmbH", stock: 1, priceList: [{ type: "ek", value: 60 }] }];
  const r = buildRanking(soloBassoStock, 4);
  assert("buildRanking: fallback a lista intera se nessuno rispetta minStock", r.ranking.length, 1);
  assert("buildRanking: nessuna nostra corrispondenza -> nostraPos null (ASSENTI)", r.nostraPos, null);
}

// ─── suggestPrice ───────────────────────────────────────────────────────────

const best = { name: "EuroMontyres S.L.", stock: 25, price: 74.85 };
const second = { name: "Tiresur S.L.", stock: 25, price: 74.9 };

assert("suggestPrice: non primi -> prezzo del 1° - vantaggio", suggestPrice({ nostraPos: 3, best, second, pricingAdvantage: 0.1 }), 74.75);
assert("suggestPrice: primi con un 2° -> prezzo del 2° - vantaggio (non del 1°, che siamo noi)", suggestPrice({ nostraPos: 1, best: { name: "Spiezia Tyres S.p.A.", stock: 20, price: 74.85 }, second, pricingAdvantage: 0.1 }), 74.8);
assert("suggestPrice: primi senza un 2° -> resta il nostro stesso prezzo (nulla da battere)", suggestPrice({ nostraPos: 1, best, second: null, pricingAdvantage: 0.1 }), 74.85);
assert("suggestPrice: nessun distributore valido -> null (il chiamante userà suggestPriceFromEk)", suggestPrice({ nostraPos: null, best: null, second: null, pricingAdvantage: 0.1 }), null);

assert("suggestPriceFromEk: stima - vantaggio", suggestPriceFromEk({ ekStimato: 73.16, pricingAdvantage: 0.1 }), 73.06);
assert("suggestPriceFromEk: nessuna stima -> null", suggestPriceFromEk({ ekStimato: null, pricingAdvantage: 0.1 }), null);

// ─── computePav ─────────────────────────────────────────────────────────────
// (costo + margineFisso + spedizione) * (1 + commissionePct)
// es. costo=59.57 (ACQ reale CAI 313048000), margine 6, spedizione 4 (IT), commissione 1.5%
assert(
  "computePav: (59.57+6+4)*1.015 arrotondato a 2 decimali",
  computePav({ costo: 59.57, margineFisso: 6, spedizione: 4, commissionePct: 0.015 }),
  Math.round((59.57 + 6 + 4) * 1.015 * 100) / 100
);

console.log(`\n${ok} OK, ${fail} FAIL`);
if (fail > 0) process.exit(1);
