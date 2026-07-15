"use client";

// Fetch paginato (offset-based) di core.utenti via GET /api/utenti, con
// infinite-scroll e drain completo (loadAll) — sostituisce
// useFirestoreInfiniteList(collectionPath:"users"), che leggeva Firestore
// direttamente dal browser via Firebase Web SDK. Stessa forma esterna
// dell'hook Firestore (items/loading/loadMore/loadAll/mutate/epoch) così il
// resto di admin/clienti/page.tsx non deve cambiare.

import { useCallback, useEffect, useRef, useState } from "react";

export interface UtenteListItem {
  id: string;
  email: string | null;
  displayName: string | null;
  ruolo: string | null;
  rappresentante: string | null;
  metodoPagamento: string | null;
  blocco: boolean;
  fido: number;
  fidoResiduo: number;
  lastLogin: string | null;
  clienteId: string | null;
}

interface Options<T> {
  pageSize?: number;
  mapItem: (u: UtenteListItem) => T;
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

export function useUtentiInfiniteList<T>({ pageSize = 100, mapItem }: Options<T>): Result<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const offsetRef = useRef(0);
  const busyRef = useRef(false);
  const epochRef = useRef(0);

  const fetchOnePage = useCallback(async (epoch: number): Promise<boolean> => {
    const res = await fetch(`/api/utenti?limit=${pageSize}&offset=${offsetRef.current}`);
    if (epoch !== epochRef.current) return false; // stantio: un reload è partito nel frattempo
    if (!res.ok) { setHasMore(false); return false; }
    const { utenti } = (await res.json()) as { utenti: UtenteListItem[] };
    if (epoch !== epochRef.current) return false;
    offsetRef.current += utenti.length;
    const full = utenti.length === pageSize;
    setItems((prev) => [...prev, ...utenti.map(mapItem)]);
    setHasMore(full);
    return full;
  }, [pageSize, mapItem]);

  const reload = useCallback(() => {
    const thisEpoch = ++epochRef.current;
    offsetRef.current = 0;
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
  }, []);

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
