import { buildConversationChunks } from './conversationImporter.js';
import { cleanText } from './triage.js';

const MESSAGE_PAGE_SIZE = 100;
const RESOLVED_EVENTS = new Set([
  'conversation_resolved',
  'conversation.resolved',
]);

export function isResolvedConversationWebhook(payload) {
  if (!payload) return false;
  const event = cleanText(payload.event);
  if (RESOLVED_EVENTS.has(event)) return true;
  if (event !== 'conversation_status_changed') return false;
  return currentStatus(payload) === 'resolved';
}

export function getWebhookAccountId(payload) {
  return (
    Number(
      payload?.account?.id ||
        payload?.conversation?.account?.id ||
        payload?.conversation?.account_id ||
        payload?.account_id
    ) || 0
  );
}

export function getWebhookConversationId(payload) {
  return (
    Number(
      payload?.conversation?.id || payload?.id || payload?.conversation_id
    ) || 0
  );
}

export async function fetchConversationMessages(
  chatwoot,
  accountId,
  conversationId,
  maxMessages
) {
  const messages = [];
  let after = 0;

  while (messages.length < maxMessages) {
    const { payload } = await chatwoot.conversationMessages(
      accountId,
      conversationId,
      { after }
    );
    if (!Array.isArray(payload) || payload.length === 0) break;

    for (const message of payload) {
      messages.push(message);
      after = Math.max(after, Number(message.id) || after);
      if (messages.length >= maxMessages) break;
    }
    if (payload.length < MESSAGE_PAGE_SIZE) break;
  }

  return messages;
}

export function buildResolutionMemoryChunks({
  payload,
  accountId,
  conversationId,
  messages,
  opts,
}) {
  const conversation = normalizeConversation(payload, conversationId);
  const sourceMessages =
    messages.length > 0
      ? messages
      : Array(conversation.messages).flat().filter(Boolean);
  const chunks = buildConversationChunks({
    accountId,
    conversation,
    messages: sourceMessages,
    opts: {
      includePrivate: opts.includePrivate,
      chunkMaxChars: opts.chunkMaxChars,
    },
  });
  const problemDescription = cleanText(
    conversation.custom_attributes?.initial_problem_description ||
      conversation.custom_attributes?.problem_description ||
      firstIncomingMessage(sourceMessages)
  );

  return chunks.map((chunk, index) => ({
    ...chunk,
    summary: summarizeResolution(chunk.content, problemDescription),
    payload: {
      ...chunk.payload,
      id: `resolution:${conversationId}:chunk:${index}:${chunk.payload.id}`,
      source: 'chatwoot_resolution',
      event: payload.event || 'conversation_resolved',
      resolution_trained: true,
      problem_description: problemDescription || null,
    },
  }));
}

export function normalizeSupportTriage(triage) {
  if (triage.support) return triage;
  return {
    support: true,
    category: 'general',
    priority: 'normal',
    reason: 'resolved_conversation',
  };
}

function currentStatus(payload) {
  const direct = cleanText(
    payload.status || payload.conversation?.status
  ).toLowerCase();
  if (direct) return direct;

  const changedAttributes = Array.isArray(payload.changed_attributes)
    ? payload.changed_attributes
    : [];
  for (const item of changedAttributes) {
    const status =
      item?.status?.current_value || item?.status?.current || item?.status?.[1];
    if (cleanText(status).toLowerCase()) return cleanText(status).toLowerCase();
  }
  return '';
}

function normalizeConversation(payload, conversationId) {
  const conversation = payload.conversation || payload;
  return {
    ...conversation,
    id: conversationId,
    account: conversation.account || payload.account,
    custom_attributes:
      conversation.custom_attributes || payload.custom_attributes || {},
    messages: conversation.messages || payload.messages || [],
    meta: conversation.meta || payload.meta || {},
  };
}

function firstIncomingMessage(messages) {
  const message = messages.find(item => {
    const messageType = item.message_type;
    return Number(messageType) === 0 || messageType === 'incoming';
  });
  return cleanText(message?.content);
}

function summarizeResolution(content, problemDescription) {
  const base = [
    'Caso resuelto entrenado desde Chatwoot.',
    problemDescription ? `Problema inicial: ${problemDescription}` : '',
    cleanText(content).slice(0, 580),
  ]
    .filter(Boolean)
    .join(' ');
  return cleanText(base).slice(0, 700);
}
