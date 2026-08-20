"use client";

type CacheEnvelope<T> = { data: T; savedAt: number };

const memory = new Map<string, CacheEnvelope<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const storagePrefix = "hae-client-cache:";

function storageKey(key: string) {
  return `${storagePrefix}${key}`;
}

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  const current = memory.get(key) as CacheEnvelope<T> | undefined;
  if (current) return current;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed || typeof parsed.savedAt !== "number" || !("data" in parsed)) return null;
    memory.set(key, parsed as CacheEnvelope<unknown>);
    return parsed;
  } catch {
    return null;
  }
}

export function peekClientCache<T>(key: string): T | null {
  return readEnvelope<T>(key)?.data ?? null;
}

export function setClientCache<T>(key: string, data: T) {
  const envelope: CacheEnvelope<T> = { data, savedAt: Date.now() };
  memory.set(key, envelope as CacheEnvelope<unknown>);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(envelope));
  } catch {
    // The in-memory cache still keeps navigation fast when storage is unavailable.
  }
}

export async function getCachedJson<T>(
  key: string,
  url: string,
  options: { maxAgeMs?: number; force?: boolean } = {},
): Promise<T> {
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const cached = readEnvelope<T>(key);
  if (!options.force && cached && Date.now() - cached.savedAt < maxAgeMs) return cached.data;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Data could not be loaded");
      setClientCache(key, payload);
      return payload as T;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export function invalidateClientCache(prefix?: string) {
  for (const key of [...memory.keys()]) if (!prefix || key.startsWith(prefix)) memory.delete(key);
  if (typeof window === "undefined") return;
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(storagePrefix)) continue;
      const logicalKey = key.slice(storagePrefix.length);
      if (!prefix || logicalKey.startsWith(prefix)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Cache invalidation is best effort only.
  }
}
