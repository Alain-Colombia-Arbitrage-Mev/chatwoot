import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/memoryStore.js';

test('qdrant requests omit api-key header when local qdrant has no key', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    calls.push(init);
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const store = new MemoryStore({
      enabled: true,
      qdrantUrl: 'http://qdrant:6333',
      qdrantApiKey: '',
      openRouterApiKey: 'or-key',
      falkorEnabled: false,
      timeoutMs: 1000
    });
    await store.qdrant('/collections/chatwoot_memory');
    assert.equal(Object.hasOwn(calls[0].headers, 'api-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
