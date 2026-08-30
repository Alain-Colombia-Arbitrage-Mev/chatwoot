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
  assert.equal(cfg.tickets.accountId, 0);
  assert.equal(cfg.tickets.labelPrefix, 'mb_ticket');
});

test('configures ticket operations from dedicated env without making token boot-critical', () => {
  const cfg = readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    VP_SUPPORT_AI_URL: 'http://vp-support:9096',
    VP_SUPPORT_AI_TOKEN: 'support-token',
    MEMORY_ENABLED: 'false',
    MEMORY_IMPORT_ACCOUNT_ID: '2',
    SUPPORT_TICKET_ACCOUNT_ID: '3',
    SUPPORT_TICKET_INBOX_ID: '7',
    SUPPORT_TICKET_TOKEN: 'ticket-token'
  });

  assert.equal(cfg.tickets.enabled, true);
  assert.equal(cfg.tickets.accountId, 3);
  assert.equal(cfg.tickets.inboxId, 7);
  assert.equal(cfg.tickets.token, 'ticket-token');
});

test('configures OpenRouter support brain without legacy VP service', () => {
  const cfg = readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    SUPPORT_AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'openrouter-token',
    OPENROUTER_CHAT_MODEL: 'upstage/solar-pro4',
    OPENROUTER_HTTP_REFERER: 'https://soporte.mindblisspower.com',
    MEMORY_ENABLED: 'false'
  });

  assert.equal(cfg.support.provider, 'openrouter');
  assert.equal(cfg.support.url, '');
  assert.equal(cfg.support.openRouter.apiKey, 'openrouter-token');
  assert.equal(cfg.support.openRouter.chatUrl, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(cfg.support.openRouter.model, 'upstage/solar-pro4');
  assert.equal(cfg.support.openRouter.referer, 'https://soporte.mindblisspower.com');
  assert.equal(cfg.support.openRouter.maxTokens, 700);
  assert.equal(cfg.support.openRouter.temperature, 0.2);
});

test('rejects OpenRouter support provider without api key', () => {
  assert.throws(() => readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    SUPPORT_AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'CHANGE_ME',
    MEMORY_ENABLED: 'false'
  }), /OPENROUTER_CHAT_API_KEY or OPENROUTER_API_KEY/);
});

test('rejects unsupported support provider', () => {
  assert.throws(() => readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    SUPPORT_AI_PROVIDER: 'unknown',
    MEMORY_ENABLED: 'false'
  }), /Unsupported SUPPORT_AI_PROVIDER/);
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

test('requires explicit production service urls when memory is enabled', () => {
  assert.throws(() => readConfig({
    CHATWOOT_WEBHOOK_SECRET: 'webhook-secret',
    CHATWOOT_API_ACCESS_TOKEN: 'chatwoot-token',
    CHATWOOT_BASE_URL: 'http://rails:3000',
    VP_SUPPORT_AI_TOKEN: 'support-token',
    MEMORY_ENABLED: 'true',
    OPENROUTER_API_KEY: 'openrouter-token',
    FALKORDB_ENABLED: 'true'
  }), /VP_SUPPORT_AI_URL.*QDRANT_URL.*FALKORDB_URL/);
});
