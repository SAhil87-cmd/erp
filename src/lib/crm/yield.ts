/** Let the event loop flush NDJSON heartbeats during long sync/classify work. */
export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
