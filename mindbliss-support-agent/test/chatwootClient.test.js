import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatwootClient } from '../src/chatwootClient.js';

test('conversationMessages explicitly sends after=0 for full-history imports', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), headers: init.headers || {} });
    return new Response('{"payload":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ChatwootClient({
      baseUrl: 'http://rails:3000',
      apiAccessToken: 'token',
      timeoutMs: 1000,
      forwardedProto: 'https'
    });
    await client.conversationMessages(1, 55);
    assert.match(requests[0].url, /after=0$/);
    assert.equal(requests[0].headers['X-Forwarded-Proto'], 'https');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
