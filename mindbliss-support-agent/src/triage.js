const SUPPORT_GROUPS = {
  auth: ['otp', 'codigo', 'código', 'validar', 'verificar', 'telefono', 'teléfono', 'login', 'entrar', 'acceso', 'password', 'contraseña'],
  payments: ['pago', 'pagos', 'compra', 'stripe', 'tarjeta', 'cargo', 'rechazado', 'fallido', 'reembolso', 'chargeback', 'devolucion', 'devolución'],
  tree: ['arbol', 'árbol', 'binario', 'referido', 'referidos', 'posicion', 'posición', 'patrocinador', 'comision', 'comisión', 'rango'],
  account: ['cuenta', 'perfil', 'kyc', 'documento', 'baneado', 'bloqueado', 'blacklist', 'usuario', 'email'],
  withdrawals: ['retiro', 'retirar', 'wallet', 'billetera', 'comisiones', 'saldo', 'ganancia']
};

const NON_SUPPORT_WORDS = [
  'publicidad',
  'promocion',
  'promoción',
  'descuento',
  'seo',
  'propuesta comercial',
  'newsletter'
];

const URGENT_WORDS = [
  'fraude',
  'hack',
  'hackeado',
  'bloqueado',
  'no puedo entrar',
  'cobro duplicado',
  'cargo no reconocido',
  'chargeback',
  'reembolso',
  'legal'
];

export function shouldProcessWebhook(payload) {
  if (!payload || payload.event !== 'message_created') return false;
  if (payload.private === true) return false;
  if (payload.message_type !== 'incoming') return false;
  if (!['text', 'incoming_email'].includes(payload.content_type || 'text')) return false;
  return cleanText(payload.content).length > 0;
}

export function classifySupportText(text) {
  const normalized = normalize(text);
  if (!normalized) {
    return { support: false, category: 'non_support', priority: 'low', reason: 'empty' };
  }

  const negative = NON_SUPPORT_WORDS.some(word => normalized.includes(normalize(word)));
  let category = 'general';
  let positives = 0;
  for (const [name, words] of Object.entries(SUPPORT_GROUPS)) {
    const hits = words.filter(word => normalized.includes(normalize(word))).length;
    if (hits > 0) {
      positives += hits;
      if (category === 'general') category = name;
    }
  }

  if (negative && positives === 0) {
    return { support: false, category: 'non_support', priority: 'low', reason: 'filtered_non_support' };
  }
  if (positives === 0) {
    return { support: false, category: 'non_support', priority: 'low', reason: 'no_support_keywords' };
  }

  const urgent = URGENT_WORDS.some(word => normalized.includes(normalize(word)));
  const priority = urgent ? 'urgent' : category === 'payments' || category === 'auth' ? 'high' : 'normal';
  return { support: true, category, priority, reason: `support:${category}` };
}

export function buildSupportPrompt(payload, triage, relatedMemories = []) {
  const sender = payload.sender || {};
  const conversation = payload.conversation || {};
  const memoryText = relatedMemories.length > 0
    ? '\n\nMemorias relacionadas de Chatwoot:\n' + relatedMemories.map((m, i) => {
      const p = m.payload || {};
      return `[M${i + 1}] ${p.category || 'general'} ${p.priority || 'normal'}: ${p.summary || p.content || ''}`;
    }).join('\n')
    : '';

  return [
    'Genera una respuesta corta y accionable para un ticket de soporte de Mindbliss Power.',
    'No prometas cambios financieros, reembolsos, compras, activaciones, comisiones ni cambios de cuenta.',
    'Si requiere validar identidad, pagos, árbol binario o estado de cuenta, indica que se escala a un agente humano.',
    '',
    `Categoria detectada: ${triage.category}`,
    `Prioridad detectada: ${triage.priority}`,
    `Conversation ID Chatwoot: ${conversation.id || ''}`,
    `Contacto: ${sender.name || sender.email || sender.phone_number || 'sin nombre'}`,
    '',
    `Mensaje del usuario:\n${cleanText(payload.content)}`,
    memoryText
  ].join('\n');
}

export function buildNote({ supportResult, triage, relatedMemories, idempotencyKey }) {
  const answer = cleanText(supportResult.answer || '');
  const escalation = supportResult.escalate ? 'si' : 'no';
  const sources = Array.isArray(supportResult.sources) ? supportResult.sources.slice(0, 5) : [];
  const sourceLines = sources.map((source, index) => {
    const title = source.titulo || source.title || source.id || `Fuente ${index + 1}`;
    const score = Number.isFinite(source.score) ? ` (${source.score.toFixed(3)})` : '';
    return `- [${index + 1}] ${title}${score}`;
  });
  const memoryLines = relatedMemories.slice(0, 3).map((memory, index) => {
    const payload = memory.payload || {};
    const summary = payload.summary || payload.content || '';
    return `- [M${index + 1}] ${summary.slice(0, 220)}`;
  });

  return [
    `**Mindbliss AI**`,
    '',
    `Prioridad: ${triage.priority}`,
    `Categoria: ${triage.category}`,
    `Escalar a humano: ${escalation}`,
    '',
    answer || 'No se generó respuesta automática; revisar manualmente.',
    '',
    sourceLines.length > 0 ? `Fuentes KB:\n${sourceLines.join('\n')}` : 'Fuentes KB: sin fuentes suficientes.',
    memoryLines.length > 0 ? `\nMemorias relacionadas:\n${memoryLines.join('\n')}` : '',
    '',
    `MB-AI-ID: ${idempotencyKey}`
  ].filter(Boolean).join('\n');
}

export function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
