"use client";

// Fetch paginato (offset-based) di b2b.marche via GET /api/marche, con
// infinite-scroll e drain completo (loadAll) — sostituisce
// useFirestoreInfiniteList(collectionPath:"Marca_Prodotto"). Stesso pattern
// di hooks/useUtentiInfiniteList.ts / useModelliInfiniteList.ts.

import { useCallback, useEffect, useRef, useState } from "react";
import type { MarcaApi } from "@/lib/marcheDb";

interface Options<T> {
  pageSize?: number;
  search?: string;
  mapItem: (m: MarcaApi) => T;
}

interface Result<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  loadAll: () => void;
  reload: () => void;
  mutate: React.Dispatch<React.SetStateAction<T[]>>;
  epoch: number;
}

export function useMarcheInfiniteList<T>({ pageSize = 100, search, mapItem }: Options<T>): Result<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [epoch, setEpoch] = useState(0);
  const offsetRef = useRef(0);
  const busyRef = useRef(false);
  const epochRef = useRef(0);

  const fetchOnePage = useCallback(async (epoch: number): Promise<boolean> => {
    const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offsetRef.current) });
    if (search) qs.set("search", search);
    const res = await fetch(`/api/marche?${qs}`);
    if (epoch !== epochRef.current) return false;
    if (!res.ok) { setHasMore(false); return false; }
    const { marche } = (await res.json()) as { marche: MarcaApi[] };
    if (epoch !== epochRef.current) return false;
    offsetRef.current += marche.length;
    const full = marche.length === pageSize;
    setItems((prev) => [...prev, ...marche.map(mapItem)]);
    setHasMore(full);
    return full;
  }, [pageSize, search, mapItem]);

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
  }, [search]);

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
