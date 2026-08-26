import { classifySupportText, cleanText } from './triage.js';

const COMMAND_PATTERN = /^\s*(?:#|\/)(kb|memoria|knowledge)\b\s*(.*)$/i;
const DEFAULT_MAX_CHARS = 8000;
const DEFAULT_MIN_CHARS = 20;
const CATEGORY_ALIASES = {
  auth: 'auth',
  autenticacion: 'auth',
  autenticación: 'auth',
  otp: 'auth',
  telefono: 'auth',
  teléfono: 'auth',
  pagos: 'payments',
  pago: 'payments',
  payments: 'payments',
  reembolsos: 'payments',
  reembolso: 'payments',
  arbol: 'tree',
  árbol: 'tree',
  tree: 'tree',
  binario: 'tree',
  referidos: 'tree',
  cuenta: 'account',
  account: 'account',
  usuario: 'account',
  retiros: 'withdrawals',
  retiro: 'withdrawals',
  withdrawals: 'withdrawals',
  general: 'general'
};
const CATEGORIES = new Set(Object.values(CATEGORY_ALIASES));

export function isKnowledgeCommandWebhook(payload) {
  if (!payload || payload.event !== 'message_created') return false;
  if (payload.private !== true) return false;
  if (!['text', 'incoming_email'].includes(payload.content_type || 'text')) return false;
  return parseCommandLine(firstLine(payload.content)).matched;
}

export function parseKnowledgeCommand(value, { maxChars = DEFAULT_MAX_CHARS, minChars = DEFAULT_MIN_CHARS } = {}) {
  const raw = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  const command = parseCommandLine(lines.shift() || '');
  if (!command.matched) return { matched: false, valid: false, reason: 'not_knowledge_command' };

  const meta = {};
  const contentLines = [];
  for (const line of lines) {
    const parsedMeta = parseMetaLine(line);
    if (parsedMeta && ['title', 'category', 'tags'].includes(parsedMeta.key)) {
      meta[parsedMeta.key] = parsedMeta.value;
    } else {
      contentLines.push(line);
    }
  }

  const content = cleanText(contentLines.join('\n') || command.remainder);
  if (content.length < minChars) {
    return { matched: true, valid: false, reason: 'knowledge_content_too_short' };
  }
  if (content.length > maxChars) {
    return { matched: true, valid: false, reason: 'knowledge_content_too_long' };
  }

  const triage = classifySupportText(content);
  const category = normalizeCategory(meta.category, triage.support ? triage.category : 'general');
  const title = cleanText(meta.title || command.remainder || content).slice(0, 120);
  return {
    matched: true,
    valid: true,
    title,
    content,
    category,
    tags: parseTags(meta.tags),
    summary: content.slice(0, 700)
  };
}

export function buildKnowledgePayload(payload, command, idempotencyKey) {
  const accountId = payload.account?.id || '';
  return {
    ...payload,
    id: `kb:${payload.id || idempotencyKey}`,
    event: 'knowledge_command',
    source: 'chatwoot_kb_note',
    kb_scope: 'account',
    kb_title: command.title,
    kb_tags: command.tags,
    private: false,
    message_type: 'incoming',
    content_type: 'text',
    content: command.content,
    sender: {
      id: `kb-account-${accountId}`,
      identifier: `kb:account:${accountId}`,
      name: 'Mindbliss Knowledge Base'
    }
  };
}

export function buildKnowledgeAck({ command, stored, idempotencyKey, error }) {
  if (!command.valid) {
    return [
      '**Mindbliss AI - memoria**',
      '',
      'No pude guardar esta nota en memoria.',
      `Motivo: ${command.reason}`,
      '',
      'Formato sugerido:',
      '#kb Titulo corto',
      'Categoria: auth|payments|tree|account|withdrawals|general',
      'Tags: otp, pagos',
      'Pregunta: ...',
      'Respuesta: ...',
      '',
      `MB-KB-ID: ${idempotencyKey}`
    ].join('\n');
  }

  if (!stored) {
    return [
      '**Mindbliss AI - memoria**',
      '',
      'No pude guardar el documento en Qdrant/FalkorDB.',
      error ? `Error: ${cleanText(error).slice(0, 180)}` : 'Error: memoria no disponible.',
      '',
      `MB-KB-ID: ${idempotencyKey}`
    ].join('\n');
  }

  const tagLine = command.tags.length > 0 ? command.tags.join(', ') : 'sin tags';
  return [
    '**Mindbliss AI - memoria**',
    '',
    'Documento guardado en memoria.',
    `Titulo: ${command.title}`,
    `Categoria: ${command.category}`,
    `Tags: ${tagLine}`,
    '',
    'Disponible para respuestas futuras del agente de soporte.',
    '',
    `MB-KB-ID: ${idempotencyKey}`
  ].join('\n');
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/, 1)[0] || '';
}

function parseCommandLine(line) {
  const match = String(line || '').match(COMMAND_PATTERN);
  if (!match) return { matched: false, remainder: '' };
  return {
    matched: true,
    remainder: cleanText(match[2] || '').replace(/^[-:]\s*/, '')
  };
}

function parseMetaLine(line) {
  const match = String(line || '').match(/^\s*(titulo|title|categoria|category|tags|etiquetas)\s*:\s*(.+)\s*$/i);
  if (!match) return null;
  const key = {
    titulo: 'title',
    title: 'title',
    categoria: 'category',
    category: 'category',
    tags: 'tags',
    etiquetas: 'tags'
  }[match[1].toLowerCase()];
  return { key, value: cleanText(match[2]) };
}

function normalizeCategory(value, fallback) {
  const normalized = cleanText(value || fallback)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  const category = CATEGORY_ALIASES[normalized] || fallback || 'general';
  return CATEGORIES.has(category) ? category : 'general';
}

function parseTags(value) {
  return cleanText(value)
    .split(',')
    .map(tag => cleanText(tag).toLowerCase())
    .filter(Boolean)
    .slice(0, 8);
}
