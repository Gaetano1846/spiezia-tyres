// Hook Next.js eseguito una sola volta all'avvio del server (stabile da
// Next 15, nessun flag experimental richiesto). Unico uso oggi: riprendere
// i job di analisi prezzi Tyre24 rimasti "running" dopo un riavvio/deploy
// del container — vedi lib/tyre24/runAnalisi.ts::resumeUnfinishedJobs.
// Import dinamico per restare fuori dal bundle Edge (questo file gira anche
// in ambienti dove il runtime non è "nodejs", es. middleware Edge).

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeUnfinishedJobs } = await import("./lib/tyre24/runAnalisi");
    resumeUnfinishedJobs().catch((err: unknown) => {
      console.error("[tyre24] Errore nella ripresa dei job interrotti:", err);
    });
  }
}
