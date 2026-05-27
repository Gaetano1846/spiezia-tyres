"use client";
import { useEffect, useState } from "react";
import {
  collection, getDocs, query, where, doc, updateDoc, arrayUnion,
} from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/components/layout/AuthProvider";
import { X } from "lucide-react";
import Link from "next/link";

type PopUpDoc = {
  id: string;
  Titolo: string;
  Descrizione?: string;
  Immagine?: string;
  Link?: string;
  ButtonText?: string;
};

export default function B2BPopUp() {
  const { user } = useAuth();
  const [queue,   setQueue]   = useState<PopUpDoc[]>([]);
  const [current, setCurrent] = useState<PopUpDoc | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;

    async function load() {
      const snap = await getDocs(
        query(collection(db, "Pop-Up"), where("Attivo", "==", true))
      );

      const unseen: PopUpDoc[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        const avvisati = (data.utentiAvvisati ?? []) as DocumentReference[];
        const alreadySeen = avvisati.some((ref) => ref.id === uid);
        if (!alreadySeen) {
          unseen.push({
            id:          d.id,
            Titolo:      data.Titolo      ?? "",
            Descrizione: data.Descrizione,
            Immagine:    data.Immagine,
            Link:        data.Link,
            ButtonText:  data.ButtonText,
          });
        }
      }

      if (unseen.length > 0) {
        setCurrent(unseen[0]);
        setQueue(unseen.slice(1));
        setVisible(true);
      }
    }

    load().catch(() => {});
  }, [user?.uid]);

  async function dismiss() {
    if (!current || !user?.uid) return;

    // Mark popup as seen (fire-and-forget)
    updateDoc(doc(db, "Pop-Up", current.id), {
      utentiAvvisati: arrayUnion(doc(db, "users", user.uid)),
    }).catch(() => {});

    // Close then advance queue
    setVisible(false);
    setTimeout(() => {
      setQueue((prev) => {
        if (prev.length > 0) {
          setCurrent(prev[0]);
          setVisible(true);
          return prev.slice(1);
        }
        setCurrent(null);
        return [];
      });
    }, 280);
  }

  if (!visible || !current) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200"
        style={{ background: "#fff" }}
      >
        {current.Immagine && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.Immagine}
            alt={current.Titolo}
            className="w-full max-h-64 object-cover"
          />
        )}

        <div className="p-6">
          <div className="flex items-start justify-between mb-3">
            <h2
              className="text-xl font-bold pr-4 leading-tight"
              style={{ fontFamily: "var(--font-poppins)", color: "var(--text-primary)" }}
            >
              {current.Titolo}
            </h2>
            <button
              onClick={dismiss}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
            >
              <X size={18} style={{ color: "var(--text-muted)" }} />
            </button>
          </div>

          {current.Descrizione && (
            <p
              className="text-sm leading-relaxed mb-5"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
            >
              {current.Descrizione}
            </p>
          )}

          <div className="flex gap-3">
            {current.Link ? (
              <>
                <Link
                  href={current.Link}
                  onClick={dismiss}
                  className="flex-1 flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                  style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
                >
                  {current.ButtonText || "Scopri di più"}
                </Link>
                <button
                  onClick={dismiss}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "var(--bg-primary)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontFamily: "var(--font-montserrat)" }}
                >
                  Chiudi
                </button>
              </>
            ) : (
              <button
                onClick={dismiss}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                style={{ background: "var(--brand)", color: "#111", fontFamily: "var(--font-montserrat)" }}
              >
                {current.ButtonText || "Ho capito"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
