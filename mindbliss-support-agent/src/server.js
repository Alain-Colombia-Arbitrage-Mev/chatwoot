import http from 'node:http';
import { readConfig } from './config.js';
import { getHeader, verifyChatwootSignature } from './security.js';
import { WebhookProcessor } from './processor.js';
import { ConversationImporter } from './conversationImporter.js';
import { TicketManager, ValidationError } from './ticketManager.js';

const config = readConfig();
const processor = new WebhookProcessor(config);
const importer = new ConversationImporter(config);
const tickets = new TicketManager(config);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { status: 'ok', memory: config.memory.enabled ? 'enabled' : 'disabled' });
    }
    if (req.method === 'GET' && req.url.startsWith('/readyz')) {
      const url = new URL(req.url, 'http://127.0.0.1');
      const result = await processor.memory.check({ external: url.searchParams.get('external') === '1' });
      return json(res, result.status === 'error' ? 503 : 200, result);
    }

    if (req.method === 'POST' && req.url === '/memory/import') {
      if (!config.import.token || getBearerToken(req.headers) !== config.import.token) {
        return json(res, 401, { error: 'invalid_import_token' });
      }
      const rawBody = await readBody(req, config.maxBodyBytes);
      const options = rawBody ? JSON.parse(rawBody) : {};
      const result = await importer.run(options);
      return json(res, result.errors.length > 0 ? 207 : 200, result);
    }

    if (req.url.startsWith('/tickets')) {
      return handleTickets(req, res);
    }

    if (req.method !== 'POST' || req.url !== '/webhooks/chatwoot') {
      return json(res, 404, { error: 'not_found' });
    }

    const rawBody = await readBody(req, config.maxBodyBytes);
    const ok = verifyChatwootSignature({
      rawBody,
      headers: req.headers,
      secret: config.webhookSecret,
      toleranceSeconds: config.webhookToleranceSeconds
    });
    if (!ok) return json(res, 401, { error: 'invalid_signature' });

    const payload = JSON.parse(rawBody);
    const deliveryId = getHeader(req.headers, 'x-chatwoot-delivery');
    const result = await processor.process(payload, deliveryId);
    return json(res, 200, result);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', msg: 'request_failed', error: error.message }));
    return json(res, 500, { error: 'internal_error' });
  }
});

server.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ level: 'info', msg: 'mindbliss_support_agent_ready', port: config.port }));
});

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readBody(req, maxBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('request_body_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function getBearerToken(headers) {
  const auth = getHeader(headers, 'authorization');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (getHeader(headers, 'x-mindbliss-ticket-token')) return getHeader(headers, 'x-mindbliss-ticket-token');
  return getHeader(headers, 'x-mindbliss-import-token');
}

async function handleTickets(req, res) {
  const authError = ticketAuthError(req);
  if (authError) return json(res, authError.status, { error: authError.error });

  const url = new URL(req.url, 'http://127.0.0.1');
  const path = url.pathname;
  try {
    if (req.method === 'GET' && path === '/tickets') {
      const params = Object.fromEntries(url.searchParams.entries());
      params.labels = url.searchParams.getAll('labels[]').concat(url.searchParams.getAll('labels'));
      return json(res, 200, await tickets.list(params));
    }
    if (req.method === 'POST' && path === '/tickets') {
      const rawBody = await readBody(req, config.maxBodyBytes);
      return json(res, 200, await tickets.create(rawBody ? JSON.parse(rawBody) : {}));
    }
    if (req.method === 'GET' && path === '/tickets/agents') {
      return json(res, 200, await tickets.agents(Object.fromEntries(url.searchParams.entries())));
    }
    if (req.method === 'GET' && path === '/tickets/teams') {
      return json(res, 200, await tickets.teams(Object.fromEntries(url.searchParams.entries())));
    }
    if (req.method === 'GET' && path === '/tickets/inboxes') {
      return json(res, 200, await tickets.inboxes(Object.fromEntries(url.searchParams.entries())));
    }

    const action = path.match(/^\/tickets\/(\d+)\/(close|escalate)$/);
    if (req.method === 'POST' && action) {
      const conversationId = Number.parseInt(action[1], 10);
      const rawBody = await readBody(req, config.maxBodyBytes);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = action[2] === 'close'
        ? await tickets.close(conversationId, body)
        : await tickets.escalate(conversationId, body);
      return json(res, 200, result);
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    if (error instanceof SyntaxError) return json(res, 400, { error: 'invalid_json' });
    if (error instanceof ValidationError) return json(res, error.statusCode, { error: error.code });
    console.error(JSON.stringify({ level: 'error', msg: 'ticket_request_failed', error: error.message }));
    return json(res, 502, { error: 'ticket_operation_failed' });
  }
}

function ticketAuthError(req) {
  if (!config.tickets.enabled) return { status: 404, error: 'not_found' };
  if (!config.tickets.token) return { status: 503, error: 'tickets_not_configured' };
  if (getBearerToken(req.headers) !== config.tickets.token) return { status: 401, error: 'invalid_ticket_token' };
  return null;
}
