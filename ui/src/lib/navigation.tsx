/**
 * lib/navigation.tsx, URL query param state, zero deps.
 *
 * Every screen keeps its state in search params so a refresh or a shared
 * link restores the exact view (the full scheme is in lib/routes.ts):
 *   ?tab=create&step=voice
 *   ?tab=library&video=<id>
 *   ?tab=settings&section=models
 *
 * navigate() moves to another screen: it replaces the whole query and adds a
 * history entry, so the browser Back button walks back through the screens.
 * setQuery() merges small changes into the current screen without a history
 * entry. popstate re-reads the URL for back/forward.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let params = new URLSearchParams(window.location.search);

function refresh() {
  params = new URLSearchParams(window.location.search);
  listeners.forEach((l) => l());
}

window.addEventListener("popstate", refresh);

/** Merge/update query params in place. An `undefined` value deletes the key. */
export function setQuery(updates: Record<string, string | undefined>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  window.history.replaceState(null, "", url.href);
  refresh();
}

/**
 * Go to a screen. The query becomes exactly `next` (stale keys are dropped).
 * `replace` swaps the current history entry instead of adding one (used for
 * automatic moves, like writing -> review when the plan is ready).
 */
export function navigate(next: Record<string, string | undefined>, opts: { replace?: boolean } = {}): void {
  const url = new URL(window.location.href);
  url.search = "";
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  if (url.href === window.location.href) return;
  if (opts.replace) window.history.replaceState(null, "", url.href);
  else window.history.pushState(null, "", url.href);
  refresh();
  if (!opts.replace) window.scrollTo({ top: 0 });
}

/** The query string a set of params would produce (for real links). */
export function hrefFor(next: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  return `?${sp.toString()}`;
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
