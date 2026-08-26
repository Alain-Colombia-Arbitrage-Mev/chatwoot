import { fetchJson } from './http.js';
import { GraphMemory } from './falkorGraph.js';
import { contactHash, deterministicPointId } from './security.js';
import { cleanText } from './triage.js';

export class MemoryStore {
  constructor(config) {
    this.config = config;
    this.graph = new GraphMemory(config);
    this.collectionReady = false;
  }

  async related(payload) {
    if (!this.enabled()) return [];
    const content = cleanText(payload.content);
    if (!content) return [];

    const hash = contactHash(payload);
    const enrichedPayload = { ...payload, contact_hash: hash };
    let hits = [];
    if (this.vectorEnabled()) {
      hits = await this.vectorRelated(enrichedPayload, content).catch(() => []);
    }
    const graphHits = await this.graph.related(enrichedPayload).catch(() => []);
    return dedupeMemories([...hits, ...graphHits]);
  }

  async store(payload, triage, supportResult) {
    if (!this.enabled()) return false;
    const content = redactSensitiveText(cleanText(payload.content).slice(0, this.config.storeMaxChars));
    if (!content) return false;

    const hash = contactHash(payload);
    const summary = cleanText(supportResult?.answer || content).slice(0, 700);
    let stored = false;

    if (this.vectorEnabled()) {
      stored = await this.storeVector(payload, hash, triage, supportResult, summary, content).catch(() => false);
    }

    const graphStored = await this.graph.store({
      payload,
      contactHash: hash,
      triage,
      supportResult,
      summary,
      content
    }).catch(() => false);
    return stored || graphStored;
  }

  enabled() {
    return Boolean(
      this.config.enabled &&
      (this.vectorEnabled() || this.graph.enabled())
    );
  }

  vectorEnabled() {
    return Boolean(
      this.config.qdrantUrl &&
      this.config.openRouterApiKey
    );
  }

  async vectorRelated(payload, content) {
    const vector = await this.embed(`query: ${content}`);
    await this.ensureCollection();
    const hits = dedupeMemories([
      ...(await this.search(payload, vector).catch(() => [])),
      ...(await this.searchAccountKnowledge(payload, vector).catch(() => []))
    ]);
    if (!this.config.rerankEnabled || hits.length < 2) return hits.slice(0, this.config.searchLimit);
    return this.rerank(content, hits).catch(() => hits);
  }

  async storeVector(payload, hash, triage, supportResult, summary, content) {
    const vector = await this.embed(`passage: ${content}`);
    await this.ensureCollection();
    const pointId = deterministicPointId(payload.account?.id, payload.conversation?.id, payload.id);
    await this.qdrant(`/collections/${encodeURIComponent(this.config.collection)}/points?wait=true`, {
      method: 'PUT',
      body: {
        points: [{
          id: pointId,
          vector,
          payload: {
            source: payload.source || 'chatwoot_webhook',
            kb_scope: payload.kb_scope || null,
            kb_title: payload.kb_title || null,
            kb_tags: Array.isArray(payload.kb_tags) ? payload.kb_tags : [],
            account_id: Number(payload.account?.id) || null,
            conversation_id: String(payload.conversation?.id || ''),
            message_id: String(payload.id || ''),
            chunk_index: Number.isFinite(payload.chunk_index) ? payload.chunk_index : null,
            message_count: Number.isFinite(payload.message_count) ? payload.message_count : null,
            contact_hash: hash,
            category: triage.category,
            priority: triage.priority,
            support_reason: triage.reason,
            ai_escalate: Boolean(supportResult?.escalate),
            content,
            summary,
            created_at: new Date().toISOString()
          }
        }]
      }
    });
    return true;
  }

  async ensureCollection() {
    if (this.collectionReady) return;
    const name = encodeURIComponent(this.config.collection);
    try {
      await this.qdrant(`/collections/${name}`);
    } catch (error) {
      if (!String(error.message).includes('404')) throw error;
      await this.qdrant(`/collections/${name}`, {
        method: 'PUT',
        body: {
          vectors: {
            size: this.config.embeddingDims,
            distance: 'Cosine'
          }
        }
      });
    }
    this.collectionReady = true;
  }

  async embed(input) {
    const response = await fetchJson(this.config.embeddingUrl, {
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openRouterApiKey}`
      },
      body: {
        model: this.config.embeddingModel,
        input
      }
    });
    const vector = response?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== this.config.embeddingDims) {
      throw new Error(`embedding dimension mismatch for ${this.config.embeddingModel}`);
    }
    return vector;
  }

  async search(payload, vector) {
    const response = await this.qdrant(`/collections/${encodeURIComponent(this.config.collection)}/points/search`, {
      method: 'POST',
      body: {
        vector,
        limit: this.config.searchLimit,
        with_payload: true,
        filter: {
          must: [
            { key: 'account_id', match: { value: Number(payload.account?.id) || 0 } },
            { key: 'contact_hash', match: { value: contactHash(payload) } }
          ]
        }
      }
    });
    return Array.isArray(response?.result) ? response.result : [];
  }

  async searchAccountKnowledge(payload, vector) {
    const response = await this.qdrant(`/collections/${encodeURIComponent(this.config.collection)}/points/search`, {
      method: 'POST',
      body: {
        vector,
        limit: this.config.searchLimit,
        with_payload: true,
        filter: {
          must: [
            { key: 'account_id', match: { value: Number(payload.account?.id) || 0 } },
            { key: 'kb_scope', match: { value: 'account' } }
          ]
        }
      }
    });
    return Array.isArray(response?.result) ? response.result : [];
  }

  async rerank(query, hits) {
    const response = await fetchJson(this.config.rerankUrl, {
      method: 'POST',
      timeoutMs: this.config.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.openRouterApiKey}`
      },
      body: {
        model: this.config.rerankModel,
        query,
        top_n: Math.min(hits.length, this.config.searchLimit),
        documents: hits.map(hit => ({ text: hit.payload?.content || hit.payload?.summary || '' }))
      }
    });
    const results = response?.results || [];
    return results
      .map(item => {
        const hit = hits[item.index];
        return hit ? { ...hit, rerank_score: item.relevance_score } : null;
      })
      .filter(Boolean);
  }

  qdrant(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.config.qdrantApiKey) headers['api-key'] = this.config.qdrantApiKey;
    return fetchJson(`${this.config.qdrantUrl}${path}`, {
      method,
      body,
      timeoutMs: this.config.timeoutMs,
      headers
    });
  }

  async check({ external = false } = {}) {
    if (!this.enabled()) return { enabled: false };
    const checks = {};

    if (this.vectorEnabled()) {
      try {
        await this.ensureCollection();
        checks.qdrant = {
          status: 'ok',
          collection: this.config.collection,
          target: safeUrlTarget(this.config.qdrantUrl)
        };
      } catch (error) {
        checks.qdrant = {
          status: 'error',
          error: error.message,
          target: safeUrlTarget(this.config.qdrantUrl)
        };
      }
    } else {
      checks.qdrant = { status: 'disabled' };
    }

    try {
      checks.falkordb = await this.graph.check();
    } catch (error) {
      checks.falkordb = { status: 'error', error: error.message };
    }

    checks.reranker = {
      status: this.config.rerankEnabled && this.config.openRouterApiKey ? 'configured' : 'disabled',
      model: this.config.rerankModel,
      target: safeUrlTarget(this.config.rerankUrl)
    };

    if (external && checks.reranker.status === 'configured') {
      try {
        await this.rerank('health check', [{ payload: { content: 'health check' } }]);
        checks.reranker.status = 'ok';
      } catch (error) {
        checks.reranker = { ...checks.reranker, status: 'error', error: error.message };
      }
    }

    const failed = Object.values(checks).some(check => check?.status === 'error');
    return { enabled: true, status: failed ? 'error' : 'ok', checks };
  }
}

function safeUrlTarget(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '';
  }
}

function dedupeMemories(memories) {
  const seen = new Set();
  return memories.filter(memory => {
    const payload = memory.payload || {};
    const key = [
      payload.source || 'qdrant',
      payload.message_id || '',
      payload.conversation_id || '',
      payload.summary || payload.content || ''
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function redactSensitiveText(text) {
  return cleanText(text)
    .replace(/\b\d{6,}\b/g, '[numero-redactado]')
    .replace(/\b(?:sk|pk|rk|or)-[A-Za-z0-9_-]{12,}\b/g, '[token-redactado]')
    .replace(/(password|contraseña|clave)\s*[:=]\s*\S+/gi, '$1=[redactado]');
}
