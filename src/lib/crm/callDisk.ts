/**
 * Disk-backed call storage for Vercel — keeps exact full-sheet history without
 * holding all CallRecord objects in RAM at once.
 */

import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import type { CallRecord } from './types';
import { yieldEventLoop } from './yield';

export const CALLS_JSONL_PATH = path.join('/tmp', 'yashodhan-crm', 'calls.jsonl');
export const CALLS_OFFSETS_PATH = path.join(
  '/tmp',
  'yashodhan-crm',
  'calls-offsets.json',
);

export type CallOffsetIndex = Map<string, number[]>;

export async function ensureCallDiskDir(): Promise<void> {
  await fs.mkdir(path.dirname(CALLS_JSONL_PATH), { recursive: true });
}

/** Open a JSONL writer; returns append helper that records byte offsets per customer. */
export async function openCallJsonlWriter(): Promise<{
  writeCall: (call: CallRecord) => void;
  close: () => Promise<{ callCount: number; offsets: CallOffsetIndex }>;
}> {
  await ensureCallDiskDir();
  await fs.writeFile(CALLS_JSONL_PATH, '', 'utf8');
  const ws = createWriteStream(CALLS_JSONL_PATH, { flags: 'w' });
  const offsets: CallOffsetIndex = new Map();
  let offset = 0;
  let callCount = 0;
  let pending = Promise.resolve();

  const writeCall = (call: CallRecord) => {
    const line = `${JSON.stringify(call)}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    const customerId = call.customerId || '';
    const list = offsets.get(customerId);
    if (list) list.push(offset);
    else offsets.set(customerId, [offset]);
    offset += bytes;
    callCount += 1;
    pending = pending.then(
      () =>
        new Promise<void>((resolve, reject) => {
          ws.write(line, (err) => (err ? reject(err) : resolve()));
        }),
    );
  };

  const close = async () => {
    await pending;
    await new Promise<void>((resolve, reject) => {
      ws.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
    await fs.writeFile(
      CALLS_OFFSETS_PATH,
      JSON.stringify(Object.fromEntries(offsets)),
      'utf8',
    );
    return { callCount, offsets };
  };

  return { writeCall, close };
}

export async function loadCallOffsetIndex(): Promise<CallOffsetIndex> {
  try {
    const raw = await fs.readFile(CALLS_OFFSETS_PATH, 'utf8');
    const obj = JSON.parse(raw) as Record<string, number[]>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

async function readCallAtOffset(
  fd: FileHandle,
  start: number,
): Promise<CallRecord | null> {
  const chunk = Buffer.alloc(4096);
  const { bytesRead } = await fd.read(chunk, 0, chunk.length, start);
  if (bytesRead <= 0) return null;
  const text = chunk.toString('utf8', 0, bytesRead);
  const nl = text.indexOf('\n');
  const line = nl >= 0 ? text.slice(0, nl) : text;
  try {
    return JSON.parse(line) as CallRecord;
  } catch {
    return null;
  }
}

/** Load all calls for one customer via byte offsets (exact, low peak RAM). */
export async function loadCallsForCustomerFromDisk(
  customerId: string,
  offsets: CallOffsetIndex,
  fd?: FileHandle,
): Promise<CallRecord[]> {
  const offs = offsets.get(customerId);
  if (!offs?.length) return [];
  const owned = !fd;
  const handle = fd ?? (await fs.open(CALLS_JSONL_PATH, 'r'));
  try {
    const out: CallRecord[] = [];
    for (const off of offs) {
      const call = await readCallAtOffset(handle, off);
      if (call) out.push(call);
    }
    return out;
  } finally {
    if (owned) await handle.close();
  }
}

/** Stream every call once (for aggregates). Does not retain the full set. */
export async function forEachCallFromDisk(
  fn: (call: CallRecord, index: number) => void | Promise<void>,
): Promise<number> {
  let index = 0;
  const rl = createInterface({
    input: createReadStream(CALLS_JSONL_PATH, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const call = JSON.parse(line) as CallRecord;
    await fn(call, index);
    index += 1;
    if (index % 500 === 0) await yieldEventLoop();
  }
  return index;
}

/** Load all calls into memory (localhost / small sets only). */
export async function loadAllCallsFromDisk(): Promise<CallRecord[]> {
  const calls: CallRecord[] = [];
  await forEachCallFromDisk((call) => {
    calls.push(call);
  });
  return calls;
}
