/**
 * lib/navigation.tsx, URL query param state, zero deps.
 *
 * Every tab exposes its state via search params so a refresh / share link
 * restores the exact view:
 *   ?tab=generate&engine=story&story=<slug>&job=<id>
 *   ?tab=providers&provider=<name>
 *   ?tab=videos&selected=<id>
 *
 * Mutations merge into the CURRENT query string and are applied with
 * history.replaceState (no history spam); popstate re-reads for back/forward.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let params = new URLSearchParams(window.location.search);

function refresh() {
  params = new URLSearchParams(window.location.search);
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", refresh);

/** Merge/update query params. `undefined` value deletes the key. */
export function setQuery(updates: Record<string, string | undefined>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", url.href);
  refresh();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function snapshot(): URLSearchParams {
  return params;
}

/** Live query params (hook). Re-renders on every change. */
export function useQuery(): URLSearchParams {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function queryKey(key: string): string | undefined {
  return params.get(key) ?? undefined;
}
