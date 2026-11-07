/**
 * Decode API snapshot payloads (plain object or gzip+base64 compact wire).
 */

export async function gunzipBase64ToText(base64: string): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser cannot decompress sheet data (DecompressionStream missing).');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export async function resolveApiSnapshot(data: {
  snapshot?: unknown;
  snapshotEncoding?: unknown;
}): Promise<unknown> {
  if (data.snapshotEncoding === 'gzip-base64' && typeof data.snapshot === 'string') {
    const text = await gunzipBase64ToText(data.snapshot);
    return JSON.parse(text) as unknown;
  }
  return data.snapshot;
}
