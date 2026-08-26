import { ChatwootClient } from './chatwootClient.js';
import {
  buildKnowledgeAck,
  buildKnowledgePayload,
  isKnowledgeCommandWebhook,
  parseKnowledgeCommand
} from './knowledgeCommand.js';
import { MemoryStore } from './memoryStore.js';
import { SupportBrain } from './supportBrain.js';
import { buildNote, buildSupportPrompt, classifySupportText, cleanText, shouldProcessWebhook } from './triage.js';

export class WebhookProcessor {
  constructor(config, deps = {}) {
    this.config = config;
    this.chatwoot = deps.chatwoot || new ChatwootClient(config.chatwoot);
    this.supportBrain = deps.supportBrain || new SupportBrain(config.support);
    this.memory = deps.memory || new MemoryStore(config.memory);
  }

  async process(payload, deliveryId = '') {
    if (isKnowledgeCommandWebhook(payload)) return this.processKnowledgeCommand(payload, deliveryId);
    if (!shouldProcessWebhook(payload)) return { status: 'ignored' };

    const triage = classifySupportText(payload.content);
    if (!triage.support) return { status: 'ignored', reason: triage.reason };

    const accountId = payload.account?.id;
    const conversationId = payload.conversation?.id;
    if (!accountId || !conversationId) {
      return { status: 'ignored', reason: 'missing_chatwoot_context' };
    }

    const idempotencyKey = `${payload.event}:${payload.id || ''}:${deliveryId || 'no-delivery'}`;
    const marker = `MB-AI-ID: ${idempotencyKey}`;
    if (await this.chatwoot.hasNoteMarker(accountId, conversationId, marker).catch(() => false)) {
      return { status: 'duplicate' };
    }

    const relatedMemories = await this.memory.related(payload).catch(() => []);
    const prompt = buildSupportPrompt(payload, triage, relatedMemories);
    const supportResult = await this.supportBrain.ask(prompt, payload.sender?.email);
    const note = buildNote({ supportResult, triage, relatedMemories, idempotencyKey });
    const labels = this.labelsFor(triage, supportResult);
    const teamId = this.config.chatwoot.teamMap[triage.priority] || null;

    await this.chatwoot.addLabels(accountId, conversationId, labels).catch(() => null);
    await this.chatwoot.setPriority(accountId, conversationId, triage.priority).catch(() => null);
    if (supportResult.escalate && this.config.chatwoot.openOnEscalate) {
      await this.chatwoot.openConversation(accountId, conversationId).catch(() => null);
    }
    if (teamId) {
      await this.chatwoot.assignTeam(accountId, conversationId, teamId).catch(() => null);
    }

    const shouldPublicReply = this.config.chatwoot.publicReplies && supportResult.escalate !== true;
    if (shouldPublicReply) {
      await this.chatwoot.createMessage(accountId, conversationId, {
        content: cleanText(supportResult.answer),
        privateMessage: false,
        sourceId: `mb-ai-public-${payload.id}`
      });
    } else {
      await this.chatwoot.createMessage(accountId, conversationId, {
        content: note,
        privateMessage: true,
        sourceId: `mb-ai-note-${payload.id}`
      });
    }

    await this.memory.store(payload, triage, supportResult).catch(() => false);
    return { status: shouldPublicReply ? 'public_reply_created' : 'private_note_created', triage };
  }

  async processKnowledgeCommand(payload, deliveryId = '') {
    if (this.config.knowledge?.enabled === false) return { status: 'ignored', reason: 'knowledge_commands_disabled' };

    const accountId = payload.account?.id;
    const conversationId = payload.conversation?.id;
    if (!accountId || !conversationId) {
      return { status: 'ignored', reason: 'missing_chatwoot_context' };
    }

    const idempotencyKey = `kb:${payload.id || deliveryId || 'no-message-id'}`;
    const marker = `MB-KB-ID: ${idempotencyKey}`;
    if (await this.chatwoot.hasNoteMarker(accountId, conversationId, marker).catch(() => false)) {
      return { status: 'duplicate' };
    }

    const command = parseKnowledgeCommand(payload.content, {
      maxChars: this.config.knowledge?.maxChars || 8000
    });

    let stored = false;
    let error = '';
    if (command.valid) {
      const triage = {
        support: true,
        category: command.category,
        priority: 'normal',
        reason: 'knowledge_base'
      };
      const memoryPayload = buildKnowledgePayload(payload, command, idempotencyKey);
      try {
        stored = await this.memory.store(memoryPayload, triage, {
          answer: command.summary,
          escalate: false,
          sources: []
        });
      } catch (err) {
        error = err.message;
      }

      await this.chatwoot.addLabels(accountId, conversationId, this.knowledgeLabels(command, stored)).catch(() => null);
    }

    await this.chatwoot.createMessage(accountId, conversationId, {
      content: buildKnowledgeAck({ command, stored, idempotencyKey, error }),
      privateMessage: true,
      sourceId: `mb-kb-note-${payload.id || deliveryId || Date.now()}`
    });

    return {
      status: stored ? 'knowledge_stored' : 'knowledge_rejected',
      reason: command.valid ? undefined : command.reason,
      knowledge: command.valid ? {
        title: command.title,
        category: command.category,
        tags: command.tags
      } : undefined
    };
  }

  labelsFor(triage, supportResult) {
    const prefix = this.config.chatwoot.labelPrefix;
    return [
      `${prefix}_support`,
      `${prefix}_${triage.priority}`,
      `${prefix}_${triage.category}`,
      supportResult.escalate ? `${prefix}_escalate` : `${prefix}_answered`
    ];
  }

  knowledgeLabels(command, stored) {
    const prefix = this.config.chatwoot.labelPrefix;
    return [
      `${prefix}_kb`,
      `${prefix}_${command.category}`,
      stored ? `${prefix}_kb_stored` : `${prefix}_kb_failed`
    ];
  }
}
