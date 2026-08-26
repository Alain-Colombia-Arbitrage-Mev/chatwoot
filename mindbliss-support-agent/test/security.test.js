import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { deterministicPointId, verifyChatwootSignature } from '../src/security.js';

test('verifies Chatwoot HMAC signature', () => {
  const secret = 'secret';
  const rawBody = '{"event":"message_created"}';
  const ts = '1787760000';
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  assert.equal(verifyChatwootSignature({
    rawBody,
    secret,
    headers: {
      'x-chatwoot-timestamp': ts,
      'x-chatwoot-signature': signature
    },
    now: Number(ts) * 1000
  }), true);
});

test('rejects old or invalid signature', () => {
  assert.equal(verifyChatwootSignature({
    rawBody: '{}',
    secret: 'secret',
    headers: {
      'x-chatwoot-timestamp': '100',
      'x-chatwoot-signature': 'sha256=bad'
    },
    now: 1787760000000
  }), false);
});

test('creates stable qdrant point ids', () => {
  assert.equal(deterministicPointId(2, 10, 99), deterministicPointId(2, 10, 99));
  assert.match(deterministicPointId(2, 10, 99), /^[a-f0-9-]{36}$/);
});
