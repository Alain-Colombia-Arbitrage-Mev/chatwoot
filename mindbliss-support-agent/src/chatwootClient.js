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
