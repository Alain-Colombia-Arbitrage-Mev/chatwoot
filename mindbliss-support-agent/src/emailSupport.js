import { classifySupportText, cleanText, redactPromptSensitiveText } from './triage.js';

const AUTOMATION_KEY = 'email_support';
const SENSITIVE_CATEGORIES = new Set(['auth', 'payments', 'tree', 'account', 'withdrawals']);

export function isEmailWebhook(payload) {
  return payload?.content_type === 'incoming_email' ||
    (payload?.conversation?.channel || payload?.channel) === 'Channel::Email';
}

export class EmailSupportProcessor {
  constructor(config = {}, { chatwoot, memory, supportBrain } = {}) {
    this.config = { routes: [], minRelevance: 0.7, ...config };
    this.chatwoot = chatwoot;
    this.memory = memory;
    this.supportBrain = supportBrain;
    this.running = new Map();
  }

  async process(payload) {
    const accountId = Number(payload?.account?.id);
    const inboxId = Number(payload?.inbox?.id || payload?.conversation?.inbox_id);
    const route = this.config.routes.find(item => item.accountId === accountId && item.inboxId === inboxId);
    if (!route) return ignored('email_inbox_not_enabled');
    if (payload.event !== 'message_created' || payload.private === true || payload.message_type !== 'incoming') {
      return ignored('not_incoming_email');
    }
    if (!Number.isSafeInteger(payload.id) || !Number.isSafeInteger(payload.conversation?.id)) {
      return ignored('invalid_email_context');
    }
    const key = `${accountId}:${payload.conversation.id}`;
    // One worker is deployed; serialize each conversation and persist send markers in Chatwoot.
    const previous = this.running.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.processIncoming(payload, route));
    this.running.set(key, current);
    try {
      return await current;
    } finally {
      if (this.running.get(key) === current) this.running.delete(key);
    }
  }

  async processIncoming(payload, route) {
    const conversationId = payload.conversation.id;
    const inbox = await this.chatwoot.getInbox(route.accountId, route.inboxId);
    const conversation = await this.chatwoot.getConversation(route.accountId, conversationId);
    if (inbox.channel_type !== 'Channel::Email' || Number(conversation.inbox_id) !== route.inboxId) {
      return ignored('email_inbox_mismatch');
    }
    const messages = await this.chatwoot.recentMessages(route.accountId, conversationId);
    const incoming = messages.find(message => Number(message.id) === payload.id);
    if (!incoming || !isIncoming(incoming) || incoming.private) return ignored('incoming_email_not_found');
    const email = incoming.content_attributes?.email;
    if (email?.auto_reply !== false ||
        /^(?:mailer-daemon|postmaster|no-?reply)(?:[+@._-]|$)/i.test(email.from?.[0] || payload.sender?.email || '')) {
      return ignored('automated_or_unverified_email');
    }
    if (conversation.status === 'resolved' || conversation.status === 'snoozed') return ignored('case_not_open');
    if (conversation.first_reply_created_at) return ignored('human_already_responded');
    const publicMessages = messages.filter(isPublicOutgoing);
    if (publicMessages.some(message => !message.content_attributes?.[AUTOMATION_KEY])) return ignored('human_already_responded');
    const sent = publicMessages.find(message => message.content_attributes?.[AUTOMATION_KEY]);
    if (conversation.custom_attributes?.email_support_processed_id) return ignored('awaiting_human');
    if (sent) {
      await this.finishHandoff(route, conversationId, sent.content_attributes[AUTOMATION_KEY]);
      return { status: 'email_handoff_recovered' };
    }

    const content = cleanText(email.text_content?.reply || email.text_content?.full || incoming.content).slice(0, 6000);
    const triage = classifySupportText(content);
    if (triage.reason === 'filtered_non_support') return ignored('bulk_or_marketing_email');
    let selected = null;
    let reason = 'no_approved_knowledge';
    if (SENSITIVE_CATEGORIES.has(triage.category) || triage.priority === 'urgent') {
      reason = 'sensitive_case';
    } else if (content) {
      try {
        const knowledge = (await this.memory.approvedKnowledge({ ...payload, content }))
          .filter(hit => Number(hit.payload?.account_id) === route.accountId &&
            Number.isFinite(hit.rerank_score) && hit.rerank_score >= this.config.minRelevance);
        selected = await this.supportBrain.selectEmailKnowledge(content, knowledge, route.companyName);
        if (selected && !knowledge.includes(selected)) selected = null;
        if (selected) reason = 'approved_knowledge';
      } catch {
        reason = 'knowledge_service_unavailable';
      }
    }

    // Do not send a stale automated reply after a human response or a newer customer email.
    const latest = await this.chatwoot.recentMessages(route.accountId, conversationId);
    const live = await this.chatwoot.getConversation(route.accountId, conversationId);
    if (live.first_reply_created_at || ['resolved', 'snoozed'].includes(live.status) || latest.some(message =>
      isPublicOutgoing(message) || (isIncoming(message) && Number(message.id) > payload.id))) {
      return ignored('conversation_changed');
    }

    const metadata = { incoming_message_id: payload.id, kind: selected ? 'knowledge' : 'acknowledgement', reason };
    await this.chatwoot.setPriority(route.accountId, conversationId, triage.priority);
    await this.assignSupport(route, conversationId, live);
    await this.chatwoot.openConversation(route.accountId, conversationId);
    await this.chatwoot.createMessage(route.accountId, conversationId, {
      content: buildEmailReply(route.companyName, conversationId, selected),
      privateMessage: false,
      botId: route.botId,
      // Chatwoot skips channel delivery when source_id is already populated.
      contentAttributes: { [AUTOMATION_KEY]: metadata }
    });
    await this.finishHandoff(route, conversationId, metadata);
    return { status: selected ? 'email_knowledge_replied' : 'email_acknowledged', reason };
  }

  async assignSupport(route, conversationId, conversation) {
    const members = await this.chatwoot.listTeamMembers(route.accountId, route.teamId);
    const eligible = members.filter(member => member.confirmed === true && member.role === 'agent');
    const currentId = conversation.meta?.assignee_type === 'User' ? conversation.meta.assignee?.id : null;
    if (currentId && !eligible.some(member => Number(member.id) === Number(currentId))) {
      // Preserve an existing human assignment; do not move a case away from its owner.
      return;
    }
    await this.chatwoot.assignTeam(route.accountId, conversationId, route.teamId);
    if (!currentId && eligible.length) {
      const agent = eligible.find(member => member.availability_status === 'online') || eligible[0];
      await this.chatwoot.assignConversation(route.accountId, conversationId, { assigneeId: agent.id });
    }
  }

  async finishHandoff(route, conversationId, metadata) {
    const marker = `MB-EMAIL-ID: ${metadata.incoming_message_id}`;
    if (!await this.chatwoot.hasNoteMarker(route.accountId, conversationId, marker)) {
      await this.chatwoot.createMessage(route.accountId, conversationId, {
        content: `Correo recibido. Respuesta automatica: ${metadata.kind}. Motivo: ${metadata.reason}. Pendiente de revision humana; no marcar como resuelto sin validar el resultado.\n${marker}`,
        privateMessage: true,
        botId: route.botId,
        sourceId: `mb-email-note-${route.accountId}-${metadata.incoming_message_id}`
      });
    }
    await this.chatwoot.addLabels(route.accountId, conversationId, ['correo-recibido', 'pendiente-soporte']);
    await this.chatwoot.updateConversationCustomAttributes(route.accountId, conversationId, {
      email_support_processed_id: metadata.incoming_message_id,
      email_support_reply_kind: metadata.kind,
      email_support_human_review_required: true,
      support_resolution_complete: false,
      support_case_ended: false
    });
  }
}

export function buildEmailReply(companyName, conversationId, selected) {
  const approved = selected ? redactPromptSensitiveText(selected.payload.content || selected.payload.summary).slice(0, 3000) : '';
  return [
    `Hola, gracias por escribir al soporte de ${companyName}. Recibimos tu correo y registramos el caso #${conversationId}.`,
    approved || 'Tu solicitud quedo en la bandeja de soporte para que un agente la revise.',
    'El caso sigue abierto. Un agente revisara tu solicitud y continuara la atencion por este mismo correo.',
    'Si aun no los enviaste, puedes responder con tu nombre completo, telefono o WhatsApp y una descripcion breve del problema. No compartas contrasenas ni codigos de verificacion.',
    'Asistente automatico de soporte'
  ].join('\n\n');
}

function isIncoming(message) {
  return message.message_type === 'incoming' || message.message_type === 0;
}

function isPublicOutgoing(message) {
  return (message.message_type === 'outgoing' || message.message_type === 1) && message.private !== true;
}

function ignored(reason) {
  return { status: 'ignored', reason };
}
