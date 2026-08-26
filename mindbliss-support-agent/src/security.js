import crypto from 'node:crypto';

export function verifyChatwootSignature({ rawBody, headers, secret, toleranceSeconds = 300, now = Date.now() }) {
  if (!secret) return false;

  const timestamp = getHeader(headers, 'x-chatwoot-timestamp');
  const signature = getHeader(headers, 'x-chatwoot-signature');
  if (!timestamp || !signature) return false;

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;

  const ageSeconds = Math.abs(Math.floor(now / 1000) - ts);
  if (ageSeconds > toleranceSeconds) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return safeEqual(expected, signature);
}

export function getHeader(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    return headers.get(name) || headers.get(lower) || '';
  }
  return headers[name] || headers[lower] || '';
}

export function contactHash(payload) {
  const sender = payload?.sender || payload?.conversation?.meta?.sender || {};
  const raw = sender.email || sender.phone_number || sender.phone || sender.identifier || sender.id || payload?.source_id || '';
  return crypto.createHash('sha256').update(String(raw).trim().toLowerCase()).digest('hex');
}

export function deterministicPointId(...parts) {
  const hex = crypto.createHash('sha256').update(parts.map(p => String(p ?? '')).join('|')).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
