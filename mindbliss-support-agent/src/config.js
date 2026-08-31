const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);
const SUPPORT_AI_PROVIDERS = new Set(['mindbliss', 'openrouter']);

export function readConfig(env = process.env) {
  const supportProvider = String(env.SUPPORT_AI_PROVIDER || 'mindbliss').trim().toLowerCase();
  const sharedOpenRouterApiKey = env.OPENROUTER_API_KEY || '';
  const openRouterChatApiKey = env.OPENROUTER_CHAT_API_KEY || sharedOpenRouterApiKey;
  const openRouterMemoryApiKey = env.OPENROUTER_MEMORY_API_KEY || sharedOpenRouterApiKey || env.OPENROUTER_CHAT_API_KEY || '';

  const cfg = {
    env: env.NODE_ENV || 'development',
    port: intFrom(env.PORT, 9108),
    webhookSecret: env.CHATWOOT_WEBHOOK_SECRET || '',
    webhookToleranceSeconds: intFrom(env.CHATWOOT_WEBHOOK_TOLERANCE_SECONDS, 300),
    maxBodyBytes: intFrom(env.CHATWOOT_WEBHOOK_MAX_BODY_BYTES, 256 * 1024),
    chatwoot: {
      baseUrl: stripTrailingSlash(env.CHATWOOT_BASE_URL || 'http://rails:3000'),
      apiAccessToken: env.CHATWOOT_API_ACCESS_TOKEN || '',
      timeoutMs: intFrom(env.CHATWOOT_API_TIMEOUT_MS, 15000),
      publicReplies: boolFrom(env.CHATWOOT_AI_PUBLIC_REPLIES, false),
      openOnEscalate: boolFrom(env.CHATWOOT_OPEN_ON_ESCALATE, true),
      teamMap: mapFrom(env.CHATWOOT_PRIORITY_TEAM_MAP || ''),
      labelPrefix: env.CHATWOOT_AI_LABEL_PREFIX || 'mb_ai',
      notePrefix: env.CHATWOOT_AI_NOTE_PREFIX || 'Mindbliss AI',
      forwardedProto: env.CHATWOOT_INTERNAL_FORWARDED_PROTO || 'https'
    },
    support: {
      provider: supportProvider,
      url: stripTrailingSlash(env.VP_SUPPORT_AI_URL || ''),
      token: env.VP_SUPPORT_AI_TOKEN || '',
      timeoutMs: intFrom(env.VP_SUPPORT_AI_TIMEOUT_MS, 45000),
      openRouter: {
        apiKey: openRouterChatApiKey,
        chatUrl: stripTrailingSlash(env.OPENROUTER_CHAT_URL || 'https://openrouter.ai/api/v1/chat/completions'),
        model: env.OPENROUTER_CHAT_MODEL || 'upstage/solar-pro4',
        referer: env.OPENROUTER_HTTP_REFERER || env.CHATWOOT_PUBLIC_URL || '',
        appTitle: env.OPENROUTER_APP_TITLE || 'Mindbliss Chatwoot Support Agent',
        timeoutMs: intFrom(env.OPENROUTER_CHAT_TIMEOUT_MS, 90000),
        maxTokens: intFrom(env.OPENROUTER_CHAT_MAX_TOKENS, 700),
        temperature: numberFrom(env.OPENROUTER_CHAT_TEMPERATURE, 0.2, { min: 0, max: 2 }),
        maxAnswerChars: intFrom(env.OPENROUTER_CHAT_MAX_ANSWER_CHARS, 1800)
      }
    },
    import: {
      token: env.MEMORY_IMPORT_TOKEN || '',
      accountId: intFrom(env.MEMORY_IMPORT_ACCOUNT_ID, 0),
      status: env.MEMORY_IMPORT_STATUS || 'all',
      supportOnly: boolFrom(env.MEMORY_IMPORT_SUPPORT_ONLY, true),
      includePrivate: boolFrom(env.MEMORY_IMPORT_INCLUDE_PRIVATE, false),
      maxPages: intFrom(env.MEMORY_IMPORT_MAX_PAGES, 25),
      maxConversations: intFrom(env.MEMORY_IMPORT_MAX_CONVERSATIONS, 500),
      maxMessagesPerConversation: intFrom(env.MEMORY_IMPORT_MAX_MESSAGES_PER_CONVERSATION, 300),
      chunkMaxChars: intFrom(env.MEMORY_IMPORT_CHUNK_MAX_CHARS, 3000),
      dryRun: boolFrom(env.MEMORY_IMPORT_DRY_RUN, false)
    },
    knowledge: {
      enabled: boolFrom(env.KNOWLEDGE_COMMANDS_ENABLED, true),
      maxChars: intFrom(env.KNOWLEDGE_COMMAND_MAX_CHARS, 8000)
    },
    resolutionMemory: {
      enabled: boolFrom(env.RESOLUTION_MEMORY_ENABLED, true),
      includePrivate: boolFrom(env.RESOLUTION_MEMORY_INCLUDE_PRIVATE, false),
      maxMessages: intFrom(env.RESOLUTION_MEMORY_MAX_MESSAGES, 150),
      chunkMaxChars: intFrom(env.RESOLUTION_MEMORY_CHUNK_MAX_CHARS, 3500)
    },
    tickets: {
      enabled: boolFrom(env.SUPPORT_TICKETS_ENABLED, true),
      token: env.SUPPORT_TICKET_TOKEN || '',
      accountId: intFrom(env.SUPPORT_TICKET_ACCOUNT_ID || env.MEMORY_IMPORT_ACCOUNT_ID, 0),
      inboxId: intFrom(env.SUPPORT_TICKET_INBOX_ID, 0),
      labelPrefix: env.SUPPORT_TICKET_LABEL_PREFIX || 'mb_ticket',
      maxContentChars: intFrom(env.SUPPORT_TICKET_MAX_CONTENT_CHARS, 8000)
    },
    memory: {
      enabled: boolFrom(env.MEMORY_ENABLED, true),
      qdrantUrl: stripTrailingSlash(env.QDRANT_URL || ''),
      qdrantApiKey: env.QDRANT_API_KEY || '',
      collection: env.QDRANT_MEMORY_COLLECTION || 'chatwoot_memory',
      openRouterApiKey: openRouterMemoryApiKey,
      embeddingUrl: env.OPENROUTER_EMBEDDING_URL || 'https://openrouter.ai/api/v1/embeddings',
      embeddingModel: env.OPENROUTER_EMBEDDING_MODEL || 'intfloat/multilingual-e5-large',
      embeddingDims: intFrom(env.OPENROUTER_EMBEDDING_DIMS, 1024),
      searchLimit: intFrom(env.MEMORY_SEARCH_LIMIT, 5),
      storeMaxChars: intFrom(env.MEMORY_STORE_MAX_CHARS, 4000),
      rerankEnabled: boolFrom(env.MEMORY_RERANK_ENABLED, true),
      rerankUrl: env.OPENROUTER_RERANK_URL || 'https://openrouter.ai/api/v1/rerank',
      rerankModel: env.SUPPORT_RERANK_MODEL || 'cohere/rerank-4-pro',
      falkorEnabled: boolFrom(env.FALKORDB_ENABLED, true),
      falkorUrl: env.FALKORDB_URL || '',
      falkorGraph: env.FALKORDB_GRAPH || 'chatwoot_memory',
      timeoutMs: intFrom(env.MEMORY_TIMEOUT_MS, 20000)
    }
  };

  const missing = [];
  if (!SUPPORT_AI_PROVIDERS.has(cfg.support.provider)) {
    throw new Error(`Unsupported SUPPORT_AI_PROVIDER: ${cfg.support.provider}`);
  }
  if (!secretPresent(cfg.webhookSecret)) missing.push('CHATWOOT_WEBHOOK_SECRET');
  if (!cfg.chatwoot.baseUrl) missing.push('CHATWOOT_BASE_URL');
  if (!secretPresent(cfg.chatwoot.apiAccessToken)) missing.push('CHATWOOT_API_ACCESS_TOKEN');
  if (cfg.support.provider === 'mindbliss') {
    if (!cfg.support.url) missing.push('VP_SUPPORT_AI_URL');
    if (!secretPresent(cfg.support.token)) missing.push('VP_SUPPORT_AI_TOKEN');
  }
  if (cfg.support.provider === 'openrouter') {
    if (!secretPresent(cfg.support.openRouter.apiKey)) missing.push('OPENROUTER_CHAT_API_KEY or OPENROUTER_API_KEY');
    if (!cfg.support.openRouter.chatUrl) missing.push('OPENROUTER_CHAT_URL');
    if (!cfg.support.openRouter.model) missing.push('OPENROUTER_CHAT_MODEL');
  }
  if (cfg.memory.enabled) {
    if (!secretPresent(cfg.memory.openRouterApiKey)) missing.push('OPENROUTER_MEMORY_API_KEY or OPENROUTER_API_KEY');
    if (!cfg.memory.qdrantUrl) missing.push('QDRANT_URL');
    if (cfg.memory.falkorEnabled && !urlConfigured(cfg.memory.falkorUrl)) missing.push('FALKORDB_URL');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  return cfg;
}

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function intFrom(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function numberFrom(value, fallback, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

function secretPresent(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized && normalized !== 'CHANGE_ME');
}

function urlConfigured(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized && !normalized.toUpperCase().includes('CHANGE_ME'));
}

function mapFrom(value) {
  const out = {};
  for (const pair of String(value).split(',')) {
    const [priority, teamId] = pair.split(':').map(part => part?.trim());
    if (!priority || !teamId) continue;
    const id = Number.parseInt(teamId, 10);
    if (Number.isFinite(id) && id > 0) out[priority.toLowerCase()] = id;
  }
  return out;
}
