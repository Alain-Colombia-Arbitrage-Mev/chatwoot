import { fetchJson } from './http.js';

export class SupportBrain {
  constructor(config) {
    this.url = config.url;
    this.token = config.token;
    this.timeoutMs = config.timeoutMs;
  }

  async ask(message, userEmail) {
    return fetchJson(`${this.url}/api/support/chat`, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-VP-Service-Token': this.token,
        'X-VP-User-Email': userEmail || 'chatwoot-support@mindblisspower.local'
      },
      body: { message }
    });
  }
}
