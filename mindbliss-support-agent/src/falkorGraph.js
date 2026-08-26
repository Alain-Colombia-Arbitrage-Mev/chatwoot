import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 5000;

export class GraphMemory {
  constructor(config) {
    this.enabledFlag = Boolean(config.enabled && config.falkorEnabled && config.falkorUrl);
    this.graph = config.falkorGraph || 'chatwoot_memory';
    this.timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.redis = this.enabledFlag ? new RedisGraphClient(config.falkorUrl, this.timeoutMs) : null;
  }

  enabled() {
    return this.enabledFlag && this.redis && this.graph;
  }

  async related(payload, limit = 3) {
    if (!this.enabled()) return [];
    const accountId = Number(payload.account?.id) || 0;
    const contactHash = payload.contact_hash || '';
    if (!accountId || !contactHash) return [];

    const query = cypherWithParams({
      account_id: accountId,
      contact_hash: contactHash,
      limit
    }, `
      MATCH (:Account {id: $account_id})-[:HAS_CONTACT]->(contact:Contact {hash: $contact_hash})-[:HAD_CONVERSATION]->(conv:Conversation)-[:HAS_MESSAGE]->(msg:Message)
      RETURN msg.category, msg.priority, msg.summary, conv.id, msg.created_at
      ORDER BY msg.created_at DESC
      LIMIT $limit
    `);

    const raw = await this.query(query, true);
    return graphRows(raw).map((row, index) => ({
      id: `falkor:${accountId}:${contactHash}:${index}`,
      score: 0,
      graph_score: 1,
      payload: {
        category: graphString(row[0]) || 'general',
        priority: graphString(row[1]) || 'normal',
        summary: graphString(row[2]),
        conversation_id: graphString(row[3]),
        created_at: graphString(row[4]),
        source: 'falkordb'
      }
    })).filter(item => item.payload.summary);
  }

  async check() {
    if (!this.enabled()) return { enabled: false };
    await this.redis.command('PING');
    return { enabled: true, status: 'ok', graph: this.graph };
  }

  async store({ payload, contactHash, triage, supportResult, summary, content }) {
    if (!this.enabled()) return false;
    const accountId = Number(payload.account?.id) || 0;
    const conversationId = String(payload.conversation?.id || '');
    const messageId = String(payload.id || '');
    if (!accountId || !contactHash || !conversationId || !messageId) return false;

    const query = cypherWithParams({
      account_id: accountId,
      contact_hash: contactHash,
      conversation_id: `${accountId}:${conversationId}`,
      chatwoot_conversation_id: conversationId,
      message_id: `${accountId}:${messageId}`,
      chatwoot_message_id: messageId,
      category: triage.category,
      priority: triage.priority,
      support_reason: triage.reason,
      escalated: Boolean(supportResult?.escalate),
      source: payload.source || 'chatwoot_webhook',
      summary,
      content,
      created_at: new Date().toISOString()
    }, `
      MERGE (a:Account {id: $account_id})
      MERGE (contact:Contact {hash: $contact_hash})
      MERGE (conv:Conversation {id: $conversation_id})
      SET conv.chatwoot_id = $chatwoot_conversation_id,
          conv.updated_at = $created_at
      MERGE (msg:Message {id: $message_id})
      SET msg.chatwoot_id = $chatwoot_message_id,
          msg.category = $category,
          msg.priority = $priority,
          msg.support_reason = $support_reason,
          msg.escalated = $escalated,
          msg.source = $source,
          msg.summary = $summary,
          msg.content = $content,
          msg.created_at = $created_at
      MERGE (cat:Category {name: $category})
      MERGE (a)-[:HAS_CONTACT]->(contact)
      MERGE (contact)-[:HAD_CONVERSATION]->(conv)
      MERGE (conv)-[:HAS_MESSAGE]->(msg)
      MERGE (msg)-[:IN_CATEGORY]->(cat)
    `);

    await this.query(query, false);
    return true;
  }

  query(query, readOnly) {
    const command = readOnly ? 'GRAPH.RO_QUERY' : 'GRAPH.QUERY';
    return this.redis.command(command, this.graph, query, 'TIMEOUT', String(this.timeoutMs));
  }
}

class RedisGraphClient {
  constructor(rawUrl, timeoutMs) {
    const parsed = new URL(rawUrl);
    this.host = parsed.hostname || '127.0.0.1';
    this.port = Number(parsed.port || 6379);
    this.username = decodeURIComponent(parsed.username || '');
    this.password = decodeURIComponent(parsed.password || '');
    this.db = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.slice(1) : '';
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  command(...args) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      let settled = false;

      const fail = error => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      const timer = setTimeout(() => fail(new Error('falkordb timeout')), this.timeoutMs);
      socket.once('error', fail);
      socket.once('connect', () => {
        const commands = [];
        if (this.password) {
          commands.push(this.username ? ['AUTH', this.username, this.password] : ['AUTH', this.password]);
        }
        if (this.db) commands.push(['SELECT', this.db]);
        commands.push(args);
        socket.write(Buffer.concat(commands.map(encodeCommand)));
      });
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const replies = [];
          let offset = 0;
          while (offset < buffer.length) {
            const parsed = parseResp(buffer, offset);
            if (!parsed) break;
            replies.push(parsed.value);
            offset = parsed.offset;
          }
          const expectedReplies = 1 + (this.password ? 1 : 0) + (this.db ? 1 : 0);
          if (replies.length >= expectedReplies) {
            settled = true;
            clearTimeout(timer);
            socket.end();
            resolve(replies[replies.length - 1]);
          }
        } catch (error) {
          fail(error);
        }
      });
    });
  }
}

function encodeCommand(args) {
  const chunks = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = Buffer.from(String(arg));
    chunks.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
}

function parseResp(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const type = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd === -1) return null;
  const line = buffer.toString('utf8', offset + 1, lineEnd);
  const next = lineEnd + 2;

  if (type === '+') return { value: line, offset: next };
  if (type === ':') return { value: Number(line), offset: next };
  if (type === '-') throw new Error(line);
  if (type === '$') {
    const length = Number(line);
    if (length === -1) return { value: null, offset: next };
    const end = next + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString('utf8', next, end), offset: end + 2 };
  }
  if (type === '*') {
    const count = Number(line);
    if (count === -1) return { value: null, offset: next };
    const items = [];
    let cursor = next;
    for (let i = 0; i < count; i += 1) {
      const parsed = parseResp(buffer, cursor);
      if (!parsed) return null;
      items.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: items, offset: cursor };
  }
  throw new Error(`Unsupported RESP type: ${type}`);
}

function cypherWithParams(params, query) {
  const keys = Object.keys(params).sort();
  const prefix = keys.length > 0
    ? `CYPHER ${keys.map(key => `${key}=${cypherLiteral(params[key])}`).join(' ')} `
    : '';
  return prefix + query.trim().replace(/\s+/g, ' ');
}

function cypherLiteral(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(cypherLiteral).join(',')}]`;
  return `'${cypherEscape(String(value ?? ''))}'`;
}

function cypherEscape(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function graphRows(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || !Array.isArray(raw[1])) return [];
  return raw[1].filter(Array.isArray);
}

function graphString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}
