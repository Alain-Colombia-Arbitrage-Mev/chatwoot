import { fetchJson } from './http.js';

export class ChatwootClient {
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.token = config.apiAccessToken;
    this.timeoutMs = config.timeoutMs;
    this.forwardedProto = config.forwardedProto || '';
  }

  async recentMessages(accountId, conversationId) {
    const path = `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
    const data = await this.request(path);
    return Array.isArray(data?.payload) ? data.payload : Array.isArray(data) ? data : [];
  }

  async listConversations(accountId, { page = 1, status = 'all', inboxId, teamId, assigneeType = 'all', q = '', labels = [] } = {}) {
    const query = new URLSearchParams({
      page: String(page),
      status,
      assignee_type: assigneeType
    });
    if (inboxId) query.set('inbox_id', String(inboxId));
    if (teamId) query.set('team_id', String(teamId));
    if (q) query.set('q', q);
    for (const label of labels) query.append('labels[]', label);

    const data = await this.request(`/api/v1/accounts/${accountId}/conversations?${query}`);
    const payload = data?.data?.payload || data?.payload || [];
    const meta = data?.data?.meta || data?.meta || {};
    return { payload: Array.isArray(payload) ? payload : [], meta };
  }

  async getConversation(accountId, conversationId) {
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}`);
  }

  async searchContacts(accountId, q) {
    const query = new URLSearchParams({ q: String(q || '') });
    const data = await this.request(`/api/v1/accounts/${accountId}/contacts/search?${query}`);
    const payload = data?.payload || data?.data?.payload || data || [];
    return Array.isArray(payload) ? payload : [];
  }

  async createContact(accountId, { inboxId, name, email, phoneNumber, identifier, customAttributes = {} }) {
    const data = await this.request(`/api/v1/accounts/${accountId}/contacts`, {
      method: 'POST',
      body: {
        inbox_id: inboxId,
        name,
        email,
        phone_number: phoneNumber,
        identifier,
        custom_attributes: customAttributes,
        blocked: false
      }
    });
    return unwrapPayload(data);
  }

  async createConversation(accountId, {
    sourceId,
    inboxId,
    contactId,
    subject,
    content,
    status = 'open',
    priority,
    assigneeId,
    teamId,
    privateMessage = false
  }) {
    const body = {
      source_id: sourceId,
      inbox_id: inboxId,
      contact_id: contactId,
      status,
      assignee_id: assigneeId,
      team_id: assigneeId ? undefined : teamId,
      additional_attributes: subject ? { mail_subject: subject } : undefined,
      message: content ? {
        content,
        private: privateMessage,
        message_type: privateMessage ? 'outgoing' : 'incoming',
        content_type: 'text'
      } : undefined
    };
    Object.keys(body).forEach(key => body[key] === undefined && delete body[key]);
    const conversation = await this.request(`/api/v1/accounts/${accountId}/conversations`, {
      method: 'POST',
      body
    });
    const conversationId = responseId(conversation);
    if (priority && priority !== 'normal' && conversationId) {
      await this.setPriority(accountId, conversationId, priority).catch(() => null);
    }
    return conversation;
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
    return this.setStatus(accountId, conversationId, 'open');
  }

  async closeConversation(accountId, conversationId) {
    return this.setStatus(accountId, conversationId, 'resolved');
  }

  async updateConversationCustomAttributes(accountId, conversationId, customAttributes) {
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/custom_attributes`, {
      method: 'POST',
      body: { custom_attributes: customAttributes }
    });
  }

  async setStatus(accountId, conversationId, status) {
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_status`, {
      method: 'POST',
      body: { status }
    });
  }

  async assignTeam(accountId, conversationId, teamId) {
    if (!teamId) return null;
    return this.assignConversation(accountId, conversationId, { teamId });
  }

  async assignConversation(accountId, conversationId, { assigneeId, teamId } = {}) {
    if (!assigneeId && !teamId) return null;
    return this.request(`/api/v1/accounts/${accountId}/conversations/${conversationId}/assignments`, {
      method: 'POST',
      body: {
        assignee_id: assigneeId,
        team_id: assigneeId ? undefined : teamId
      }
    });
  }

  async listAgents(accountId) {
    const data = await this.request(`/api/v1/accounts/${accountId}/agents`);
    const payload = data?.payload || data?.data?.payload || data || [];
    return Array.isArray(payload) ? payload : [];
  }

  async listTeams(accountId) {
    const data = await this.request(`/api/v1/accounts/${accountId}/teams`);
    const payload = data?.payload || data?.data?.payload || data || [];
    return Array.isArray(payload) ? payload : [];
  }

  async listInboxes(accountId) {
    const data = await this.request(`/api/v1/accounts/${accountId}/inboxes`);
    const payload = data?.payload || data?.data?.payload || data || [];
    return Array.isArray(payload) ? payload : [];
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
    const headers = {
      'Content-Type': 'application/json',
      api_access_token: this.token
    };
    if (this.forwardedProto) headers['X-Forwarded-Proto'] = this.forwardedProto;

    return fetchJson(`${this.baseUrl}${path}`, {
      method,
      body,
      timeoutMs: this.timeoutMs,
      headers
    });
  }
}

function unwrapPayload(data) {
  if (Array.isArray(data?.payload)) return data.payload[0] || data;
  if (data?.payload?.contact) return data.payload.contact;
  if (data?.payload && typeof data.payload === 'object') return data.payload;
  return data;
}

function responseId(data) {
  return Number(data?.id || data?.payload?.id || data?.data?.id) || 0;
}
