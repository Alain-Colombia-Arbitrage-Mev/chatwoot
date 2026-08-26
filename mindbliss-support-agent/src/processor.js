import { ChatwootClient } from './chatwootClient.js';
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

  labelsFor(triage, supportResult) {
    const prefix = this.config.chatwoot.labelPrefix;
    return [
      `${prefix}_support`,
      `${prefix}_${triage.priority}`,
      `${prefix}_${triage.category}`,
      supportResult.escalate ? `${prefix}_escalate` : `${prefix}_answered`
    ];
  }
}
