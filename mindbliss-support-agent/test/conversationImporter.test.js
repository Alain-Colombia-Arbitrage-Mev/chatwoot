import assert from 'node:assert/strict';
import test from 'node:test';
import { ConversationImporter, buildConversationChunks, normalizeOptions } from '../src/conversationImporter.js';

test('normalizes importer options with bounded limits', () => {
  assert.deepEqual(normalizeOptions({
    account_id: '7',
    status: 'resolved',
    max_pages: '999',
    max_conversations: '0',
    include_private: 'true',
    dry_run: 'true'
  }), {
    accountId: 7,
    status: 'resolved',
    inboxId: 0,
    teamId: 0,
    supportOnly: true,
    includePrivate: true,
    maxPages: 250,
    maxConversations: 1,
    maxMessagesPerConversation: 300,
    chunkMaxChars: 3000,
    dryRun: true
  });
});

test('builds redacted conversation chunks without private notes', () => {
  const chunks = buildConversationChunks({
    accountId: 1,
    conversation: { id: 55, meta: { sender: { email: 'cliente@example.com' } } },
    messages: [
      { id: 1, content: 'No llega el codigo OTP', message_type: 'incoming', content_type: 'text', private: false },
      { id: 2, content: 'nota interna', message_type: 'outgoing', content_type: 'text', private: true },
      { id: 3, content: 'Validaremos el telefono', message_type: 'outgoing', content_type: 'text', private: false }
    ],
    opts: { includePrivate: false, chunkMaxChars: 500 }
  });

  assert.equal(chunks.length, 1);
  assert.match(chunks[0].content, /cliente/);
  assert.match(chunks[0].content, /agente/);
  assert.doesNotMatch(chunks[0].content, /nota interna/);
  assert.equal(chunks[0].payload.source, 'chatwoot_backfill');
});

test('imports support conversations into memory store', async () => {
  const stored = [];
  const importer = new ConversationImporter({
    import: {},
    chatwoot: {},
    memory: {}
  }, {
    chatwoot: {
      listConversations: async (_accountId, { page }) => ({
        payload: page === 1 ? [{ id: 99, meta: { sender: { email: 'cliente@example.com' } } }] : []
      }),
      conversationMessages: async () => ({
        payload: [
          { id: 11, content: 'Mi pago no activa el arbol binario', message_type: 'incoming', content_type: 'text', private: false }
        ]
      })
    },
    memory: {
      store: async (...args) => stored.push(args)
    }
  });

  const result = await importer.run({ account_id: 3, max_pages: 2, max_conversations: 10 });

  assert.equal(result.conversations_seen, 1);
  assert.equal(result.chunks_stored, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0][0].source, 'chatwoot_backfill');
  assert.equal(stored[0][1].category, 'payments');
});
