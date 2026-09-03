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
    createMessage: async (...args) => calls.push(['message', ...args]),
  };
  const memory = {
    related: async () => [
      { payload: { summary: 'Usuario tuvo OTP fallido antes' } },
    ],
    store: async (...args) => calls.push(['store', ...args]),
  };
  const supportBrain = {
    ask: async () => ({
      answer: 'Revisar validacion OTP y telefono.',
      escalate: true,
      sources: [],
    }),
  };
  const router = {
    route: async (...args) => {
      calls.push(['route', ...args]);
      return {
        enabled: true,
        status: 'routed',
        strategy: 'routing_rule',
        ruleName: 'auth-high',
        reason: 'matched_rule:auth-high',
        teamId: 8,
        assigneeId: 9,
        assigneeEmail: 'agent@example.com',
        confidence: 0.75,
      };
    },
    apply: async (...args) => calls.push(['routeApply', ...args]),
  };
  const processor = new WebhookProcessor(
    {
      chatwoot: {
        teamMap: { urgent: 9, high: 8 },
        publicReplies: false,
        openOnEscalate: true,
        labelPrefix: 'mb_ai',
      },
    },
    { chatwoot, memory, supportBrain, router }
  );

  const result = await processor.process(
    {
      event: 'message_created',
      id: 77,
      private: false,
      message_type: 'incoming',
      content_type: 'text',
      content: 'No llega el codigo OTP al telefono',
      account: { id: 2 },
      conversation: { id: 15 },
      sender: { email: 'cliente@example.com' },
    },
    'delivery-1'
  );

  assert.equal(result.status, 'private_note_created');
  assert.equal(
    calls.some(
      call => call[0] === 'message' && call[3].privateMessage === true
    ),
    true
  );
  assert.equal(
    calls.some(call => call[0] === 'labels'),
    true
  );
  assert.equal(
    calls.some(call => call[0] === 'store'),
    true
  );
  assert.equal(result.routing.teamId, 8);
  assert.equal(
    calls.some(call => call[0] === 'routeApply'),
    true
  );
  const messageCall = calls.find(call => call[0] === 'message');
  assert.match(messageCall[3].content, /Routing automatico/);
});

test('stores private kb command as account knowledge', async () => {
  const calls = [];
  const chatwoot = {
    hasNoteMarker: async () => false,
    addLabels: async (...args) => calls.push(['labels', ...args]),
    createMessage: async (...args) => calls.push(['message', ...args]),
  };
  const memory = {
    store: async (...args) => {
      calls.push(['store', ...args]);
      return true;
    },
  };
  const supportBrain = {
    ask: async () => {
      throw new Error('kb command should not call support brain');
    },
  };
  const processor = new WebhookProcessor(
    {
      chatwoot: { labelPrefix: 'mb_ai' },
      knowledge: { enabled: true, maxChars: 8000 },
    },
    { chatwoot, memory, supportBrain }
  );

  const result = await processor.process(
    {
      event: 'message_created',
      id: 88,
      private: true,
      message_type: 'outgoing',
      content_type: 'text',
      content:
        '#kb OTP SMS\nCategoria: auth\nEl codigo OTP puede solicitarse por SMS cuando falla el correo.',
      account: { id: 2 },
      conversation: { id: 15 },
      sender: { email: 'agent@example.com' },
    },
    'delivery-2'
  );

  const storeCall = calls.find(call => call[0] === 'store');
  const messageCall = calls.find(call => call[0] === 'message');
  assert.equal(result.status, 'knowledge_stored');
  assert.equal(storeCall[1].source, 'chatwoot_kb_note');
  assert.equal(storeCall[1].kb_scope, 'account');
  assert.equal(storeCall[2].category, 'auth');
  assert.equal(messageCall[3].privateMessage, true);
  assert.match(messageCall[3].content, /Documento guardado en memoria/);
});

test('stores resolved conversations in memory without asking support brain', async () => {
  const calls = [];
  const chatwoot = {
    conversationMessages: async () => ({
      payload: [
        {
          id: 100,
          message_type: 'incoming',
          content_type: 'text',
          content: 'No llega el codigo OTP al telefono',
        },
        {
          id: 101,
          message_type: 'outgoing',
          content_type: 'text',
          content: 'Se valido el numero y el OTP fue reenviado por SMS.',
        },
      ],
    }),
    addLabels: async (...args) => calls.push(['labels', ...args]),
  };
  const memory = {
    store: async (...args) => {
      calls.push(['store', ...args]);
      return true;
    },
  };
  const supportBrain = {
    ask: async () => {
      throw new Error('resolved webhook should not call support brain');
    },
  };
  const processor = new WebhookProcessor(
    {
      chatwoot: { labelPrefix: 'mb_ai' },
      resolutionMemory: {
        enabled: true,
        includePrivate: false,
        maxMessages: 150,
        chunkMaxChars: 3500,
      },
    },
    { chatwoot, memory, supportBrain }
  );

  const result = await processor.process(
    {
      event: 'conversation_resolved',
      id: 15,
      account: { id: 2 },
      custom_attributes: {
        initial_problem_description: 'No llega el codigo OTP al telefono',
      },
      meta: { sender: { email: 'cliente@example.com' } },
    },
    'delivery-3'
  );

  const storeCall = calls.find(call => call[0] === 'store');
  assert.equal(result.status, 'resolution_memory_stored');
  assert.equal(result.stored, 1);
  assert.equal(storeCall[1].source, 'chatwoot_resolution');
  assert.equal(storeCall[2].support, true);
  assert.equal(
    calls.some(
      call => call[0] === 'labels' && call[3].includes('mb_ai_memory_trained')
    ),
    true
  );
});
