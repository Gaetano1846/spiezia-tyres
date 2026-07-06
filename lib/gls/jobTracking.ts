// Tracking lato client dei job di spedizione bulk (SpedizioniJobs). Usa
// localStorage così un job avviato sopravvive alla navigazione tra pagine admin
// E a un refresh del browser (il job stesso gira lato server/Firestore — questo
// modulo serve solo a ricordare "quali jobId sto seguendo in questa sessione").
// Eventi custom per notificare il widget (components/admin/SpedizioniJobsWidget)
// senza dover passare per un Context/prop-drilling attraverso il layout.

const STORAGE_KEY = "spiezia_gls_active_jobs";

export function getTrackedJobIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function trackGlsJob(jobId: string): void {
  if (typeof window === "undefined") return;
  const ids = getTrackedJobIds();
  if (ids.includes(jobId)) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids, jobId]));
  window.dispatchEvent(new CustomEvent("gls-job-added", { detail: jobId }));
}

export function untrackGlsJob(jobId: string): void {
  if (typeof window === "undefined") return;
  const ids = getTrackedJobIds().filter((id) => id !== jobId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  window.dispatchEvent(new CustomEvent("gls-job-removed", { detail: jobId }));
}
