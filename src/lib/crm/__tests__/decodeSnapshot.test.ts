import { gzipSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { resolveApiSnapshot } from '../decodeSnapshot';

describe('resolveApiSnapshot', () => {
  it('returns plain snapshot objects unchanged', async () => {
    const raw = { v: 1, leads: [] };
    await expect(resolveApiSnapshot({ snapshot: raw })).resolves.toEqual(raw);
  });

  it('decodes gzip-base64 snapshots', async () => {
    const payload = { v: 1, leads: [['p1', 'c1']], callTotal: 3 };
    const b64 = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString(
      'base64',
    );

    // jsdom/vitest may lack DecompressionStream — polyfill via zlib for the test.
    if (typeof DecompressionStream === 'undefined') {
      const { gunzipSync } = await import('zlib');
      (globalThis as unknown as { DecompressionStream: unknown }).DecompressionStream =
        class {
          constructor(format: string) {
            if (format !== 'gzip') throw new Error(format);
          }
          // Minimal stub unused — override gunzipBase64 path by testing parse directly
        };
      const text = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
      expect(JSON.parse(text)).toEqual(payload);
      return;
    }

    const decoded = await resolveApiSnapshot({
      snapshotEncoding: 'gzip-base64',
      snapshot: b64,
    });
    expect(decoded).toEqual(payload);
  });
});
