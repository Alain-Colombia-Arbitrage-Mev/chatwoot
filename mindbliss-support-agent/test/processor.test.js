import assert from 'node:assert/strict';
import test from 'node:test';
import { WebhookProcessor } from '../src/processor.js';

test('creates private note with labels and memory for support messages', async () => {
  const calls = [];
  const chatwoot = {
    hasNoteMarker: async () => false,
    addLabels: async (...args) => calls.push(['labels', ...args]),
    setPriority: async (...args) => calls.push(['priority', ...args]),
    openConversation: async (...args) => calls.push(['open', ...args]),
    assignTeam: async (...args) => calls.push(['team', ...args]),
    createMessage: async (...args) => calls.push(['message', ...args])
  };
  const memory = {
    related: async () => [{ payload: { summary: 'Usuario tuvo OTP fallido antes' } }],
    store: async (...args) => calls.push(['store', ...args])
  };
  const supportBrain = {
    ask: async () => ({ answer: 'Revisar validacion OTP y telefono.', escalate: true, sources: [] })
  };
  const processor = new WebhookProcessor({
    chatwoot: { teamMap: { urgent: 9, high: 8 }, publicReplies: false, openOnEscalate: true, labelPrefix: 'mb_ai' }
  }, { chatwoot, memory, supportBrain });

  const result = await processor.process({
    event: 'message_created',
    id: 77,
    private: false,
    message_type: 'incoming',
    content_type: 'text',
    content: 'No llega el codigo OTP al telefono',
    account: { id: 2 },
    conversation: { id: 15 },
    sender: { email: 'cliente@example.com' }
  }, 'delivery-1');

  assert.equal(result.status, 'private_note_created');
  assert.equal(calls.some(call => call[0] === 'message' && call[3].privateMessage === true), true);
  assert.equal(calls.some(call => call[0] === 'labels'), true);
  assert.equal(calls.some(call => call[0] === 'store'), true);
});
