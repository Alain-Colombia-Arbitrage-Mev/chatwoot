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

test('createConversation sends assignment and subject fields', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: JSON.parse(init.body || '{}') });
    return new Response('{"id":77}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const client = new ChatwootClient({
      baseUrl: 'http://rails:3000',
      apiAccessToken: 'token',
      timeoutMs: 1000
    });
    await client.createConversation(2, {
      sourceId: 'cliente@example.com',
      inboxId: 7,
      contactId: 44,
      subject: 'OTP no llega',
      content: 'No llega el codigo',
      priority: 'normal',
      assigneeId: 9
    });

    assert.match(requests[0].url, /\/api\/v1\/accounts\/2\/conversations$/);
    assert.equal(requests[0].body.assignee_id, 9);
    assert.equal(requests[0].body.additional_attributes.mail_subject, 'OTP no llega');
    assert.equal(requests[0].body.message.message_type, 'incoming');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
