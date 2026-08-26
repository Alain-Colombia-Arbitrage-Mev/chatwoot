import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatwootClient } from '../src/chatwootClient.js';

test('conversationMessages explicitly sends after=0 for full-history imports', async () => {
  const urls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    urls.push(String(url));
    return new Response('{"payload":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ChatwootClient({
      baseUrl: 'http://rails:3000',
      apiAccessToken: 'token',
      timeoutMs: 1000
    });
    await client.conversationMessages(1, 55);
    assert.match(urls[0], /after=0$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
