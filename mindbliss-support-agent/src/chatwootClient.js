import { fetchJson } from './http.js';

export class ChatwootClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.token = config.apiAccessToken;
    this.timeoutMs = config.timeoutMs;
  }

  async recentMessages(accountId, conversationId) {
    const path = `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
    const data = await this.request(path);
    return Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [];
  }

  async listConversations(accountId, { page = 1, status = 'all', inboxId, teamId } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      status,
      assignee_type: 'all'
    });
    if (inboxId) query.set('inbox_id', String(inboxId));
    if (teamId) query.set('team_id', String(teamId));

    const data = await this.request(`/api/v1/accounts/${accountId}/conversations?${query}`);
    const payload = data?.data?.payload || data?.payload || [];
    const meta = data?.data?.meta || data?.meta || {};
    return { payload: Array.isArray(payload) ? payload : [], meta };
  }

  async conversationMessages(accountId, conversationId, { after = 0 } = {}) {
    const query = new URLSearchParams();
    if (Number(after) >= 0) query.set('after', String(after));
    const suffix = query.toString() ? `?${query}` : '';
    const data = await this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages${suffix}`);
    return {
      payload: Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [],
      meta: data?.meta || {}
    };
  }

  async hasNoteMarker(accountId, conversationId, marker) {
    const messages = await this.recentMessages(accountId, conversationId);
    return messages.some(message => message.private === true && String(message.content || '').includes(marker));
  }

  async createMessage(accountId, conversationId, { content, privateMessage = true, sourceId }) {
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: {
        content,
        private: privateMessage,
        message_type: 'outgoing',
        content_type: 'text',
        source_id: sourceId
      }
    });
  }

  async setPriority(accountId, conversationId, priority) {
    if (!priority || priority === 'normal') return null;
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_priority`, {
      method: 'POST',
      body: { priority }
    });
  }

  async openConversation(accountId, conversationId) {
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`, {
      method: 'POST',
      body: { status: 'open' }
    });
  }

  async assignTeam(accountId, conversationId, teamId) {
    if (!teamId) return null;
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/assignments`, {
      method: 'POST',
      body: { team_id: teamId }
    });
  }

  async addLabels(accountId, conversationId, newLabels) {
    if (!newLabels.length) return null;
    const existing = await this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`)
      .catch(() => ({ payload: [] }));
    const labels = Array.from(new Set([...(existing?.payload || existing || []), ...newLabels]));
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`, {
      method: 'POST',
      body: { labels }
    });
  }

  request(path, { method = 'GET', body } = {}) {
    return fetchJson(`${this.baseUrl}${path}`, {
      method,
      body,
      timeoutMs: this.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        api_access_token: this.token
      }
    });
  }
}
