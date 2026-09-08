import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/memoryStore.js';

test('email knowledge excludes foreign and unapproved memories before reranking', async () => {
  const store = new MemoryStore({ enabled: true, rerankEnabled: true, qdrantUrl: 'http://qdrant:6333', openRouterApiKey: 'test' });
  store.embed = async () => [];
  store.searchAccountKnowledge = async () => [
    { payload: { account_id: 2, kb_scope: 'account', source: 'chatwoot_kb_note', content: 'approved' } },
    { payload: { account_id: 3, kb_scope: 'account', source: 'chatwoot_kb_note', content: 'foreign' } },
    { payload: { account_id: 2, source: 'chatwoot_resolution', content: 'unreviewed generated answer' } }
  ];
  store.graph.related = async () => [];
  let rerankCalls = 0;
  store.rerank = async (_query, hits) => {
    rerankCalls += 1;
    assert.equal(hits.length, 1);
    assert.equal(hits[0].payload.content, 'approved');
    return hits;
  };
  assert.equal((await store.approvedKnowledge({ account: { id: 2 }, content: 'support question' })).length, 1);
  assert.equal(rerankCalls, 1);
  store.rerank = async () => { throw new Error('reranker offline'); };
  await assert.rejects(store.approvedKnowledge({ account: { id: 2 }, content: 'support question' }), /reranker offline/);
});

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

test('stores knowledge metadata in qdrant payload', async () => {
  const bodies = [];
  const store = new MemoryStore({
    enabled: true,
    qdrantUrl: 'http://qdrant:6333',
    qdrantApiKey: '',
    openRouterApiKey: 'or-key',
    collection: 'chatwoot_memory',
    embeddingDims: 2,
    timeoutMs: 1000
  });
  store.embed = async () => [0.1, 0.2];
  store.ensureCollection = async () => {};
  store.qdrant = async (_path, options) => bodies.push(options.body);

  await store.storeVector({
    source: 'chatwoot_kb_note',
    kb_scope: 'account',
    kb_title: 'OTP SMS',
    kb_tags: ['otp'],
    account: { id: 2 },
    conversation: { id: 15 },
    id: 'kb:88'
  }, 'hash', {
    category: 'auth',
    priority: 'normal',
    reason: 'knowledge_base'
  }, {
    escalate: false
  }, 'summary', 'content');

  const payload = bodies[0].points[0].payload;
  assert.equal(payload.source, 'chatwoot_kb_note');
  assert.equal(payload.kb_scope, 'account');
  assert.equal(payload.kb_title, 'OTP SMS');
  assert.deepEqual(payload.kb_tags, ['otp']);
});

test('vector related includes contact memory and account knowledge', async () => {
  const store = new MemoryStore({
    enabled: true,
    qdrantUrl: 'http://qdrant:6333',
    qdrantApiKey: '',
    openRouterApiKey: 'or-key',
    collection: 'chatwoot_memory',
    embeddingDims: 2,
    rerankEnabled: false,
    timeoutMs: 1000
  });
  store.embed = async () => [0.1, 0.2];
  store.ensureCollection = async () => {};
  store.search = async () => [{ payload: { source: 'qdrant', message_id: 'm1', summary: 'contact memory' } }];
  store.searchAccountKnowledge = async () => [{
    payload: { source: 'chatwoot_kb_note', message_id: 'kb1', summary: 'account kb' }
  }];

  const related = await store.vectorRelated({
    account: { id: 2 },
    conversation: { id: 15 },
    sender: { email: 'cliente@example.com' }
  }, 'No recibo el codigo OTP');

  assert.equal(related.length, 2);
  assert.equal(related.some(item => item.payload.summary === 'account kb'), true);
});

test('readiness reports redacted qdrant and reranker targets', async () => {
  const store = new MemoryStore({
    enabled: true,
    qdrantUrl: 'http://:secret@mindbrain-qdrant:6333',
    qdrantApiKey: '',
    openRouterApiKey: 'or-key',
    collection: 'chatwoot_memory',
    embeddingDims: 2,
    rerankEnabled: true,
    rerankUrl: 'https://openrouter.ai/api/v1/rerank',
    rerankModel: 'cohere/rerank-4-pro',
    falkorEnabled: false,
    timeoutMs: 1000
  });
  store.ensureCollection = async () => {};

  const result = await store.check();

  assert.equal(result.checks.qdrant.target, 'http://mindbrain-qdrant:6333');
  assert.equal(result.checks.reranker.target, 'https://openrouter.ai/api/v1/rerank');
});
