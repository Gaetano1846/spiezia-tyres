"use client";

// Fetch paginato (cursor-based) di una collezione Firestore, con infinite-scroll
// e un'uscita di sicurezza per drenare l'intera collezione quando un filtro
// client-side (ricerca testuale, toggle) richiede dati completi per essere
// corretto — altrimenti il filtro vedrebbe solo la pagina già caricata.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection, query, orderBy, limit, startAfter, getDocs,
  type QueryDocumentSnapshot, type OrderByDirection, type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Options<T> {
  collectionPath: string;
  orderByField: string;
  orderDirection?: OrderByDirection;
  pageSize?: number;
  mapDoc: (id: string, data: DocumentData) => T;
}

interface Result<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadAll: () => void;
  reload: () => void;
  /** Aggiornamento ottimistico locale (stile SWR `mutate`) — evita un refetch dopo create/update/delete. */
  mutate: React.Dispatch<React.SetStateAction<T[]>>;
  /** Incrementa a ogni reload() — usalo come dep di un effect "se c'è un filtro attivo, loadAll()"
   *  così il drain riparte anche quando il testo di ricerca non è cambiato ma i dati sì. */
  epoch: number;
}

export function useFirestoreInfiniteList<T>({
  collectionPath, orderByField, orderDirection = "asc", pageSize = 100, mapDoc,
}: Options<T>): Result<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const busyRef = useRef(false);
  const epochRef = useRef(0);

  const fetchOnePage = useCallback(async (epoch: number): Promise<boolean> => {
    const col = collection(db, collectionPath);
    const q = cursorRef.current
      ? query(col, orderBy(orderByField, orderDirection), startAfter(cursorRef.current), limit(pageSize))
      : query(col, orderBy(orderByField, orderDirection), limit(pageSize));
    const snap = await getDocs(q);
    if (epoch !== epochRef.current) return false; // stantio: un reload è partito nel frattempo
    const mapped = snap.docs.map((d) => mapDoc(d.id, d.data()));
    cursorRef.current = snap.docs[snap.docs.length - 1] ?? cursorRef.current;
    const full = snap.docs.length === pageSize;
    setItems((prev) => [...prev, ...mapped]);
    setHasMore(full);
    return full;
  }, [collectionPath, orderByField, orderDirection, pageSize, mapDoc]);

  const reload = useCallback(() => {
    const thisEpoch = ++epochRef.current;
    cursorRef.current = null;
    busyRef.current = true;
    setItems([]);
    setHasMore(true);
    setLoading(true);
    setEpoch(thisEpoch);
    fetchOnePage(thisEpoch).finally(() => {
      busyRef.current = false;
      if (thisEpoch === epochRef.current) setLoading(false);
    });
  }, [fetchOnePage]);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionPath, orderByField, orderDirection]);

  const loadMore = useCallback(() => {
    if (busyRef.current || !hasMore) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    setLoadingMore(true);
    fetchOnePage(epoch).finally(() => {
      busyRef.current = false;
      setLoadingMore(false);
    });
  }, [fetchOnePage, hasMore]);

  const loadAll = useCallback(() => {
    if (busyRef.current || !hasMore) return;
    const epoch = epochRef.current;
    busyRef.current = true;
    setLoadingMore(true);
    (async () => {
      let more = true;
      while (more && epoch === epochRef.current) {
        more = await fetchOnePage(epoch);
      }
    })().finally(() => {
      busyRef.current = false;
      setLoadingMore(false);
    });
  }, [fetchOnePage, hasMore]);

  return { items, loading, loadingMore, hasMore, loadMore, loadAll, reload, mutate: setItems, epoch };
}
