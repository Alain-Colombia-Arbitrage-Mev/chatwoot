import crypto from 'node:crypto';
import { fetchJson as defaultFetchJson } from './http.js';
import { cleanText } from './triage.js';

const OPENROUTER_SYSTEM_PROMPT = [
  'Eres un agente AI de soporte para Mindbliss Power integrado a Chatwoot.',
  'Responde solo JSON valido, sin markdown y sin texto extra.',
  'Esquema exacto: {"answer":"texto para soporte o cliente","escalate":true,"sources":[]}.',
  'answer debe estar en espanol, ser corto, claro, accionable y no pasar de 8 lineas.',
  'No prometas reembolsos, activaciones, movimientos de dinero, compras, comisiones ni cambios de cuenta.',
  'Escala si requiere validar identidad, pagos, arbol binario, KYC, legal, seguridad, acceso bloqueado, estado de cuenta o si no hay certeza.',
  'sources debe ser un arreglo corto de referencias disponibles en el prompt; si no hay fuentes, usa [].'
].join('\n');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'si', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off']);

export class SupportBrain {
  constructor(config, deps = {}) {
    this.config = config || {};
    this.provider = this.config.provider || 'mindbliss';
    this.fetchJson = deps.fetchJson || defaultFetchJson;
  }

  async ask(message, userEmail) {
    if (this.provider === 'openrouter') {
      return this.askOpenRouter(message, userEmail);
    }
    return this.askMindbliss(message, userEmail);
  }

  async askMindbliss(message, userEmail) {
    return this.fetchJson(`${this.config.url}/api/support/chat`, {
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-VP-Service-Token': this.config.token,
        'X-VP-User-Email': userEmail || 'chatwoot-support@mindblisspower.local'
      },
      body: { message }
    });
  }

  async askOpenRouter(message, userEmail) {
    const cfg = this.config.openRouter || {};
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    };
    if (cfg.referer) headers['HTTP-Referer'] = cfg.referer;
    if (cfg.appTitle) headers['X-OpenRouter-Title'] = cfg.appTitle;

    const body = {
      model: cfg.model,
      messages: [
        { role: 'system', content: OPENROUTER_SYSTEM_PROMPT },
        { role: 'user', content: String(message || '') }
      ],
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens
    };
    const user = pseudonymousUser(userEmail);
    if (user) body.user = user;

    const response = await this.fetchJson(cfg.chatUrl, {
      method: 'POST',
      timeoutMs: cfg.timeoutMs || this.config.timeoutMs,
      headers,
      body
    });
    const parsed = parseSupportJson(contentFromOpenRouter(response), cfg.maxAnswerChars);
    return {
      ...parsed,
      provider: 'openrouter',
      model: cfg.model,
      usage: safeUsage(response?.usage)
    };
  }
}

export function pseudonymousUser(value) {
  const normalized = cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (!normalized) return '';
  return `chatwoot:${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`;
}

export function parseSupportJson(text, maxAnswerChars = 1800) {
  const parsed = parseJsonEnvelope(text);
  if (!parsed) {
    const fallbackAnswer = cleanText(stripCodeFence(text)).slice(0, maxAnswerChars);
    return {
      answer: fallbackAnswer || 'No se genero una respuesta automatica confiable; revisar manualmente.',
      escalate: true,
      sources: []
    };
  }

  const answer = cleanText(parsed.answer || parsed.respuesta || parsed.message || '').slice(0, maxAnswerChars);
  return {
    answer: answer || 'No se genero una respuesta automatica confiable; revisar manualmente.',
    escalate: boolLike(parsed.escalate ?? parsed.escalar ?? parsed.requires_escalation, true),
    sources: normalizeSources(parsed.sources || parsed.fuentes)
  };
}

function contentFromOpenRouter(response) {
  const content = response?.choices?.[0]?.message?.content ?? response?.choices?.[0]?.text ?? response?.output_text ?? '';
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || '';
    }).join('\n').trim();
  }
  return String(content || '').trim();
}

function parseJsonEnvelope(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const objectSlice = start >= 0 && end > start ? raw.slice(start, end + 1) : '';
  const candidates = [raw, fenced, stripCodeFence(raw), objectSlice].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function stripCodeFence(text) {
  return String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function boolLike(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  if (!normalized) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
}

function normalizeSources(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(source => {
    if (typeof source === 'string') {
      const title = cleanText(source).slice(0, 160);
      return title ? { title } : null;
    }
    if (!source || typeof source !== 'object') return null;
    const title = cleanText(source.title || source.titulo || source.id || source.url || '').slice(0, 160);
    const score = Number.parseFloat(source.score ?? source.relevance_score);
    const out = {};
    if (title) out.title = title;
    if (Number.isFinite(score)) out.score = score;
    return Object.keys(out).length > 0 ? out : null;
  }).filter(Boolean).slice(0, 5);
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const out = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cost']) {
    if (usage[key] !== undefined) out[key] = usage[key];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
