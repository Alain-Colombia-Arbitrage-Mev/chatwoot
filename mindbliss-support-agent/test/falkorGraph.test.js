import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphMemory } from '../src/falkorGraph.js';

test('stores account knowledge as KnowledgeDocument graph node', async () => {
  const commands = [];
  const graph = new GraphMemory({
    enabled: true,
    falkorEnabled: true,
    falkorUrl: 'redis://:pass@falkordb:6379',
    falkorGraph: 'chatwoot_memory',
    timeoutMs: 1000
  });
  graph.redis = {
    command: async (...args) => {
      commands.push(args);
      return [];
    }
  };

  const stored = await graph.store({
    payload: {
      source: 'chatwoot_kb_note',
      kb_scope: 'account',
      kb_title: 'OTP SMS',
      kb_tags: ['otp'],
      account: { id: 2 },
      conversation: { id: 15 },
      id: 'kb:88'
    },
    contactHash: 'hash',
    triage: { category: 'auth', priority: 'normal', reason: 'knowledge_base' },
    supportResult: { escalate: false },
    summary: 'OTP SMS summary',
    content: 'OTP SMS content'
  });

  assert.equal(stored, true);
  assert.equal(commands[0][0], 'GRAPH.QUERY');
  assert.match(commands[0][2], /KnowledgeDocument/);
  assert.match(commands[0][2], /HAS_KB_DOC/);
});
