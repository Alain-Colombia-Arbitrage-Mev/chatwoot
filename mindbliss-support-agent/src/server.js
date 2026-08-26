import http from 'node:http';
import { readConfig } from './config.js';
import { getHeader, verifyChatwootSignature } from './security.js';
import { WebhookProcessor } from './processor.js';

const config = readConfig();
const processor = new WebhookProcessor(config);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { status: 'ok', memory: config.memory.enabled ? 'enabled' : 'disabled' });
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
