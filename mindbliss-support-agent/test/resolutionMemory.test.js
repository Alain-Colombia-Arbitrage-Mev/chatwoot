import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResolutionMemoryChunks,
  getWebhookAccountId,
  getWebhookConversationId,
  isResolvedConversationWebhook,
} from '../src/resolutionMemory.js';

test('detects resolved conversation webhooks from status change and resolved event', () => {
  assert.equal(
    isResolvedConversationWebhook({ event: 'conversation_resolved' }),
    true
  );
  assert.equal(
    isResolvedConversationWebhook({
      event: 'conversation.status_changed',
      status: 'resolved',
    }),
    false
  );
  assert.equal(
    isResolvedConversationWebhook({
      event: 'conversation_status_changed',
      changed_attributes: [
        { status: { previous_value: 'open', current_value: 'resolved' } },
      ],
    }),
    true
  );
  assert.equal(
    isResolvedConversationWebhook({
      event: 'conversation_status_changed',
      changed_attributes: [
        { status: { previous_value: 'open', current_value: 'pending' } },
      ],
    }),
    false
  );
});

test('extracts account and conversation ids from conversation webhook shape', () => {
  const payload = {
    event: 'conversation_resolved',
    id: 44,
    account: { id: 2 },
  };

  assert.equal(getWebhookAccountId(payload), 2);
  assert.equal(getWebhookConversationId(payload), 44);
});

test('builds sanitized resolution memory chunks with initial problem metadata', () => {
  const chunks = buildResolutionMemoryChunks({
    payload: {
      event: 'conversation_resolved',
      id: 44,
      account: { id: 2 },
      custom_attributes: {
        initial_problem_description: 'No llega el codigo OTP',
      },
      meta: { sender: { email: 'cliente@example.com' } },
    },
    accountId: 2,
    conversationId: 44,
    messages: [
      {
        id: 1,
        message_type: 'incoming',
        content_type: 'text',
        content: 'No llega el codigo OTP',
      },
      {
        id: 2,
        message_type: 'outgoing',
        content_type: 'text',
        content: 'Se valido telefono y se reenvio OTP por SMS.',
      },
    ],
    opts: { includePrivate: false, chunkMaxChars: 3500 },
  });

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].payload.source, 'chatwoot_resolution');
  assert.equal(chunks[0].payload.event, 'conversation_resolved');
  assert.equal(chunks[0].payload.problem_description, 'No llega el codigo OTP');
  assert.match(chunks[0].payload.id, /^resolution:44:chunk:0:/);
  assert.match(chunks[0].content, /\[cliente\] No llega el codigo OTP/);
  assert.match(chunks[0].content, /\[agente\] Se valido telefono/);
});
