import { ChatwootClient } from './chatwootClient.js';
import { MemoryStore } from './memoryStore.js';
import { classifySupportText, cleanText } from './triage.js';

const MESSAGE_PAGE_SIZE = 100;

export class ConversationImporter {
  constructor(config, deps = {}) {
    this.config = config;
    this.chatwoot = deps.chatwoot || new ChatwootClient(config.chatwoot);
    this.memory = deps.memory || new MemoryStore(config.memory);
  }

  async run(options = {}) {
    const opts = normalizeOptions(mergeImportOptions(this.config.import, options));
    if (!opts.accountId) throw new Error('account_id is required');

    const summary = {
      account_id: opts.accountId,
      status: opts.status,
      dry_run: opts.dryRun,
      support_only: opts.supportOnly,
      pages_seen: 0,
      conversations_seen: 0,
      conversations_imported: 0,
      chunks_seen: 0,
      chunks_stored: 0,
      skipped_non_support: 0,
      errors: []
    };

    for (let page = 1; page <= opts.maxPages; page += 1) {
      const { payload: conversations } = await this.chatwoot.listConversations(opts.accountId, {
        page,
        status: opts.status,
        inboxId: opts.inboxId,
        teamId: opts.teamId
      });
      summary.pages_seen = page;
      if (conversations.length === 0) break;

      for (const conversation of conversations) {
        if (summary.conversations_seen >= opts.maxConversations) return summary;
        summary.conversations_seen += 1;

        try {
          const result = await this.importConversation(opts.accountId, conversation, opts);
          summary.conversations_imported += result.stored > 0 ? 1 : 0;
          summary.chunks_seen += result.chunks;
          summary.chunks_stored += result.stored;
          summary.skipped_non_support += result.skippedNonSupport;
        } catch (error) {
          summary.errors.push({
            conversation_id: conversation.id,
            error: error.message
          });
        }
      }
    }

    return summary;
  }

  async importConversation(accountId, conversation, opts) {
    const messages = await this.fetchConversationMessages(accountId, conversation.id, opts.maxMessagesPerConversation);
    const chunks = buildConversationChunks({ accountId, conversation, messages, opts });
    const result = { chunks: chunks.length, stored: 0, skippedNonSupport: 0 };

    for (const chunk of chunks) {
      const triage = classifySupportText(chunk.content);
      if (opts.supportOnly && !triage.support) {
        result.skippedNonSupport += 1;
        continue;
      }

      if (!opts.dryRun) {
        await this.memory.store(chunk.payload, normalizeTriage(triage), {
          answer: chunk.summary,
          escalate: false,
          sources: []
        });
      }
      result.stored += 1;
    }

    return result;
  }

  async fetchConversationMessages(accountId, conversationId, maxMessages) {
    const messages = [];
    let after = 0;

    while (messages.length < maxMessages) {
      const { payload } = await this.chatwoot.conversationMessages(accountId, conversationId, { after });
      if (payload.length === 0) break;

      for (const message of payload) {
        messages.push(message);
        after = Math.max(after, Number(message.id) || after);
        if (messages.length >= maxMessages) break;
      }
      if (payload.length < MESSAGE_PAGE_SIZE) break;
    }

    return messages;
  }
}

export function buildConversationChunks({ accountId, conversation, messages, opts }) {
  const usable = messages
    .filter(message => opts.includePrivate || message.private !== true)
    .filter(message => ['text', 'incoming_email'].includes(message.content_type || 'text'))
    .filter(message => cleanText(message.content).length > 0)
    .map(message => ({
      ...message,
      content: cleanText(message.content),
      role: Number(message.message_type) === 1 || message.message_type === 'outgoing' ? 'agente' : 'cliente'
    }));

  const chunks = [];
  let lines = [];
  let chars = 0;
  let firstMessageId = '';
  let lastMessageId = '';

  const flush = () => {
    if (lines.length === 0) return;
    const content = lines.join('\n');
    const index = chunks.length;
    chunks.push({
      content,
      summary: summarizeChunk(content),
      payload: {
        source: 'chatwoot_backfill',
        event: 'memory_import',
        id: `conversation:${conversation.id}:chunk:${index}:${firstMessageId}:${lastMessageId}`,
        chunk_index: index,
        message_count: lines.length,
        private: false,
        message_type: 'incoming',
        content_type: 'text',
        content,
        account: { id: accountId },
        conversation: { id: conversation.id },
        sender: conversation.meta?.sender || usable.find(message => message.sender)?.sender || {}
      }
    });
    lines = [];
    chars = 0;
    firstMessageId = '';
    lastMessageId = '';
  };

  for (const message of usable) {
    const line = `[${message.role}] ${message.content}`;
    if (chars > 0 && chars + line.length + 1 > opts.chunkMaxChars) flush();
    if (!firstMessageId) firstMessageId = String(message.id || '');
    lastMessageId = String(message.id || lastMessageId);
    lines.push(line);
    chars += line.length + 1;
  }
  flush();

  return chunks;
}

export function normalizeOptions(raw) {
  return {
    accountId: positiveInt(raw.accountId ?? raw.account_id),
    status: oneOf(raw.status, ['all', 'open', 'resolved', 'pending', 'snoozed'], 'all'),
    inboxId: positiveInt(raw.inboxId ?? raw.inbox_id),
    teamId: positiveInt(raw.teamId ?? raw.team_id),
    supportOnly: booleanFrom(raw.supportOnly ?? raw.support_only, true),
    includePrivate: booleanFrom(raw.includePrivate ?? raw.include_private, false),
    maxPages: boundedInt(raw.maxPages ?? raw.max_pages, 1, 250, 25),
    maxConversations: boundedInt(raw.maxConversations ?? raw.max_conversations, 1, 10000, 500),
    maxMessagesPerConversation: boundedInt(raw.maxMessagesPerConversation ?? raw.max_messages_per_conversation, 1, 1000, 300),
    chunkMaxChars: boundedInt(raw.chunkMaxChars ?? raw.chunk_max_chars, 500, 12000, 3000),
    dryRun: booleanFrom(raw.dryRun ?? raw.dry_run, false)
  };
}

function mergeImportOptions(defaults = {}, overrides = {}) {
  return {
    accountId: overrides.accountId ?? overrides.account_id ?? defaults.accountId ?? defaults.account_id,
    status: overrides.status ?? defaults.status,
    inboxId: overrides.inboxId ?? overrides.inbox_id ?? defaults.inboxId ?? defaults.inbox_id,
    teamId: overrides.teamId ?? overrides.team_id ?? defaults.teamId ?? defaults.team_id,
    supportOnly: overrides.supportOnly ?? overrides.support_only ?? defaults.supportOnly ?? defaults.support_only,
    includePrivate: overrides.includePrivate ?? overrides.include_private ?? defaults.includePrivate ?? defaults.include_private,
    maxPages: overrides.maxPages ?? overrides.max_pages ?? defaults.maxPages ?? defaults.max_pages,
    maxConversations: overrides.maxConversations ?? overrides.max_conversations ?? defaults.maxConversations ?? defaults.max_conversations,
    maxMessagesPerConversation:
      overrides.maxMessagesPerConversation ??
      overrides.max_messages_per_conversation ??
      defaults.maxMessagesPerConversation ??
      defaults.max_messages_per_conversation,
    chunkMaxChars: overrides.chunkMaxChars ?? overrides.chunk_max_chars ?? defaults.chunkMaxChars ?? defaults.chunk_max_chars,
    dryRun: overrides.dryRun ?? overrides.dry_run ?? defaults.dryRun ?? defaults.dry_run
  };
}

function normalizeTriage(triage) {
  if (triage.support) return triage;
  return { support: true, category: 'general', priority: 'normal', reason: 'import:non_support_allowed' };
}

function summarizeChunk(content) {
  return cleanText(content).slice(0, 700);
}

function positiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function boundedInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function booleanFrom(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}
