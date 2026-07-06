"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import Link from "next/link";
import { X, Truck, AlertTriangle, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { getTrackedJobIds, untrackGlsJob } from "@/lib/gls/jobTracking";
import type { SpedizioneJob } from "@/lib/types";

// Widget globale (montato nel layout admin, quindi visibile su ogni pagina
// /admin/*) che segue live i job di spedizione bulk GLS avviati dall'utente
// (vedi lib/gls/jobTracking.ts + app/api/gls-italy/route.ts). Permette di
// navigare tra le pagine mentre la creazione etichette gira in background sul
// server, mostrando sempre il progresso e — a fine job — quali ordini sono
// falliti (con link diretto al dettaglio ordine).

export default function SpedizioniJobsWidget() {
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Record<string, SpedizioneJob | null>>({});
  const notifiedRef = useRef<Set<string>>(new Set());

  // Inizializza dai job tracciati in questo browser + ascolta nuovi job avviati
  // da questa pagina o (dopo un refresh) quelli già in corso prima del reload.
  useEffect(() => {
    setTrackedIds(getTrackedJobIds());
    function onAdded(e: Event) {
      const jobId = (e as CustomEvent<string>).detail;
      setTrackedIds((prev) => (prev.includes(jobId) ? prev : [...prev, jobId]));
    }
    function onRemoved(e: Event) {
      const jobId = (e as CustomEvent<string>).detail;
      setTrackedIds((prev) => prev.filter((id) => id !== jobId));
    }
    window.addEventListener("gls-job-added", onAdded);
    window.addEventListener("gls-job-removed", onRemoved);
    return () => {
      window.removeEventListener("gls-job-added", onAdded);
      window.removeEventListener("gls-job-removed", onRemoved);
    };
  }, []);

  // Un listener realtime per job tracciato.
  useEffect(() => {
    const unsubs = trackedIds.map((jobId) =>
      onSnapshot(doc(db, "SpedizioniJobs", jobId), (snap) => {
        if (!snap.exists()) {
          setJobs((prev) => { const next = { ...prev }; delete next[jobId]; return next; });
          return;
        }
        const job = { id: snap.id, ...(snap.data() as Omit<SpedizioneJob, "id">) };
        setJobs((prev) => ({ ...prev, [jobId]: job }));

        if ((job.status === "done" || job.status === "error") && !notifiedRef.current.has(jobId)) {
          notifiedRef.current.add(jobId);
          if (job.status === "error") {
            toast.error(`Spedizione GLS ${job.sede}: errore — ${job.error ?? "sconosciuto"}`);
          } else if (job.failedOrders > 0) {
            toast.error(`Spedizione GLS ${job.sede}: ${job.successOrders} ok, ${job.failedOrders} falliti`);
          } else {
            toast.success(`Spedizione GLS ${job.sede} completata — ${job.successOrders} ordini`);
          }
        }
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [trackedIds]);

  function dismiss(jobId: string) {
    untrackGlsJob(jobId);
    setJobs((prev) => { const next = { ...prev }; delete next[jobId]; return next; });
  }

  const visibleJobs = trackedIds.map((id) => jobs[id]).filter((j): j is SpedizioneJob => !!j);
  if (visibleJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[300px] max-w-[calc(100vw-2rem)]">
      {visibleJobs.map((job) => (
        <div
          key={job.id}
          className="rounded-2xl overflow-hidden"
          style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "var(--shadow-xl)" }}
        >
          <div className="flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-2">
              {job.status === "running" ? (
                <Truck size={14} style={{ color: "var(--brand)" }} />
              ) : job.status === "error" || job.failedOrders > 0 ? (
                <AlertTriangle size={14} style={{ color: "#EF4444" }} />
              ) : (
                <CheckCircle2 size={14} style={{ color: "#22C55E" }} />
              )}
              <span className="text-xs font-bold" style={{ fontFamily: "var(--font-poppins)" }}>
                Spedizione GLS {job.sede}
              </span>
            </div>
            <button onClick={() => dismiss(job.id)} className="p-1 rounded-lg hover:bg-gray-100">
              <X size={12} style={{ color: "var(--text-muted)" }} />
            </button>
          </div>

          <div className="px-4 pt-2 pb-3">
            {job.status === "error" ? (
              <p className="text-[11px]" style={{ color: "#EF4444", fontFamily: "var(--font-montserrat)" }}>
                {job.error ?? "Errore sconosciuto"}
              </p>
            ) : (
              <>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${job.totalOrders ? (job.processedOrders / job.totalOrders) * 100 : 0}%`,
                      background: job.status === "running" ? "var(--brand)" : job.failedOrders > 0 ? "#EF4444" : "#22C55E",
                    }}
                  />
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}>
                  {job.processedOrders}/{job.totalOrders} ordini
                  {job.status === "running" ? " — elaborazione in corso…" : ""}
                  {job.status !== "running" && job.failedOrders > 0 ? ` · ${job.failedOrders} falliti` : ""}
                </p>
              </>
            )}

            {job.status === "done" && job.failures.length > 0 && (
              <div className="mt-2 pt-2 space-y-1" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "#EF4444" }}>
                  Ordini falliti
                </p>
                {job.failures.slice(0, 5).map((f) => (
                  <Link
                    key={f.orderId}
                    href={`/admin/ordini/${f.orderId}`}
                    className="block text-[11px] hover:underline"
                    style={{ fontFamily: "var(--font-montserrat)" }}
                  >
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{f.orderId}</span>
                    <span style={{ color: "var(--text-muted)" }}> — {f.error}</span>
                  </Link>
                ))}
                {job.failures.length > 5 && (
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    +{job.failures.length - 5} altri
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
