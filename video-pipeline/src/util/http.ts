/** Tiny fetch helpers using Node's global fetch (Node 20+). No deps. */

import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export async function getJson<T = unknown>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json() as Promise<T>;
}

export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${(await res.text()).slice(0, 800)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** Download a URL to a local file path. */
export async function download(url: string, dest: string, headers: Record<string, string> = {}): Promise<void> {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) throw new Error(`Download failed ${url} -> ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
}
