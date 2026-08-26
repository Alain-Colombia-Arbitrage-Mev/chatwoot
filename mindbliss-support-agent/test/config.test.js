import assert from 'node:assert/strict';
import test from 'node:test';
import { readConfig } from '../src/config.js';

test('rejects placeholder secrets instead of booting half-configured', () => {
  assert.throws(() => readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'CHANGE_ME',
    CHATWOOT_API_ACCESS_TOKEN: 'CHANGE_ME',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    VP_SUPPORT_AI_URL: 'http://vp-support:9096',
    VP_SUPPORT_AI_TOKEN: 'CHANGE_ME',
    MEMORY_ENABLED: 'true',
    OPENROUTER_API_KEY: 'CHANGE_ME',
    QDRANT_URL: 'http://mindbliss-qdrant:6333',
    FALKORDB_URL: 'redis://mindbliss-falkordb:6379'
  }), /Missing required env vars/);
});

test('allows local qdrant without api key when network is private', () => {
  const cfg = readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    VP_SUPPORT_AI_URL: 'http://vp-support:9096',
    VP_SUPPORT_AI_TOKEN: 'support-token',
    MEMORY_ENABLED: 'true',
    OPENROUTER_API_KEY: 'openrouter-token',
    QDRANT_URL: 'http://mindbliss-qdrant:6333',
    QDRANT_API_KEY: '',
    FALKORDB_ENABLED: 'true',
    FALKORDB_URL: 'redis://mindbliss-falkordb:6379'
  });

  assert.equal(cfg.memory.qdrantApiKey, '');
  assert.equal(cfg.memory.qdrantUrl, 'http://mindbliss-qdrant:6333');
});

test('rejects placeholder credentials inside falkordb url', () => {
  assert.throws(() => readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    VP_SUPPORT_AI_URL: 'http://vp-support:9096',
    VP_SUPPORT_AI_TOKEN: 'support-token',
    MEMORY_ENABLED: 'true',
    OPENROUTER_API_KEY: 'openrouter-token',
    QDRANT_URL: 'http://qdrant:6333',
    FALKORDB_ENABLED: 'true',
    FALKORDB_URL: 'redis://:CHANGE_ME@falkordb:6379'
  }), /FALKORDB_URL/);
});
