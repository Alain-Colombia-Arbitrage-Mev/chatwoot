import { ChatwootClient } from './chatwootClient.js';
import { cleanText } from './triage.js';

const STATUSES = new Set(['all', 'open', 'resolved', 'pending', 'snoozed']);
const CREATE_STATUSES = new Set(['open', 'resolved', 'pending', 'snoozed']);
const ASSIGNEE_TYPES = new Set(['me', 'unassigned', 'all', 'assigned']);
const PRIORITIES = new Set(['normal', 'low', 'medium', 'high', 'urgent']);

export class ValidationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.statusCode = 400;
  }
}

export class TicketManager {
  constructor(config, deps = {}) {
    this.config = config;
    this.chatwoot = deps.chatwoot || new ChatwootClient(config.chatwoot);
  }

  async list(raw = {}) {
    const opts = normalizeListOptions(raw, this.config.tickets);
    const result = await this.chatwoot.listConversations(opts.accountId, opts);
    return {
      status: 'ok',
      tickets: result.payload.map(compactConversation),
      meta: result.meta
    };
  }

  async create(raw = {}) {
    const input = normalizeCreateTicket(raw, this.config.tickets);
    const assigneeId = await this.resolveAssigneeId(input.accountId, input.assigneeId, input.assigneeEmail);
    const contact = await this.resolveContact(input);
    const sourceId = input.sourceId || sourceIdFor(contact, input.inboxId) || input.contact.email ||
      input.contact.phoneNumber || input.contact.identifier || `mindbliss-ticket-${Date.now()}`;

    const conversation = await this.chatwoot.createConversation(input.accountId, {
      sourceId,
      inboxId: input.inboxId,
      contactId: contact.id,
      subject: input.subject,
      content: input.content,
      status: input.status,
      priority: input.priority,
      assigneeId,
      teamId: input.teamId
    });
    const conversationId = conversationIdFrom(conversation);
    if (!conversationId) throw new Error('chatwoot conversation id missing');

    await this.applyTicketMetadata(input.accountId, conversationId, {
      action: 'created',
      priority: input.priority,
      category: input.category,
      labels: input.labels
    });
    if (assigneeId || input.teamId) {
      await this.chatwoot.assignConversation(input.accountId, conversationId, {
        assigneeId,
        teamId: input.teamId
      });
    }
    if (input.note) {
      await this.chatwoot.createMessage(input.accountId, conversationId, {
        content: buildTicketNote('Ticket creado', input.note),
        privateMessage: true,
        sourceId: `mb-ticket-create-${conversationId}`
      });
    }

    return {
      status: 'ticket_created',
      ticket: compactConversation({ ...conversation, id: conversationId }),
      assignment: compactAssignment({ assigneeId, teamId: input.teamId, assigneeEmail: input.assigneeEmail })
    };
  }

  async close(conversationId, raw = {}) {
    const input = normalizeTicketAction(raw, this.config.tickets);
    if (input.note) {
      await this.chatwoot.createMessage(input.accountId, conversationId, {
        content: buildTicketNote('Ticket cerrado', input.note),
        privateMessage: true,
        sourceId: `mb-ticket-close-${conversationId}-${Date.now()}`
      });
    }
    await this.applyTicketMetadata(input.accountId, conversationId, {
      action: 'closed',
      priority: 'normal',
      labels: input.labels
    });
    const conversation = await this.chatwoot.closeConversation(input.accountId, conversationId);
    return { status: 'ticket_closed', ticket: compactConversation(conversation) };
  }

  async escalate(conversationId, raw = {}) {
    const input = normalizeEscalation(raw, this.config.tickets);
    const assigneeId = await this.resolveAssigneeId(input.accountId, input.assigneeId, input.assigneeEmail);

    await this.chatwoot.openConversation(input.accountId, conversationId);
    if (input.priority !== 'normal') {
      await this.chatwoot.setPriority(input.accountId, conversationId, input.priority);
    }
    if (assigneeId || input.teamId) {
      await this.chatwoot.assignConversation(input.accountId, conversationId, {
        assigneeId,
        teamId: input.teamId
      });
    }
    await this.applyTicketMetadata(input.accountId, conversationId, {
      action: 'escalated',
      priority: input.priority,
      category: input.category,
      labels: input.labels
    });
    if (input.note || input.assigneeEmail) {
      const emailLine = input.assigneeEmail ? `Responsable: ${input.assigneeEmail}` : '';
      await this.chatwoot.createMessage(input.accountId, conversationId, {
        content: buildTicketNote('Ticket escalado', [emailLine, input.note].filter(Boolean).join('\n')),
        privateMessage: true,
        sourceId: `mb-ticket-escalate-${conversationId}-${Date.now()}`
      });
    }

    return {
      status: 'ticket_escalated',
      ticket: compactConversation({ id: conversationId, status: 'open', priority: input.priority }),
      assignment: compactAssignment({ assigneeId, teamId: input.teamId, assigneeEmail: input.assigneeEmail })
    };
  }

  async agents(raw = {}) {
    const accountId = accountIdFrom(raw.account_id ?? raw.accountId, this.config.tickets);
    const agents = await this.chatwoot.listAgents(accountId);
    return { status: 'ok', agents: agents.map(compactAgent) };
  }

  async teams(raw = {}) {
    const accountId = accountIdFrom(raw.account_id ?? raw.accountId, this.config.tickets);
    const teams = await this.chatwoot.listTeams(accountId);
    return { status: 'ok', teams: teams.map(compactTeam) };
  }

  async inboxes(raw = {}) {
    const accountId = accountIdFrom(raw.account_id ?? raw.accountId, this.config.tickets);
    const inboxes = await this.chatwoot.listInboxes(accountId);
    return { status: 'ok', inboxes: inboxes.map(compactInbox) };
  }

  async resolveAssigneeId(accountId, assigneeId, assigneeEmail) {
    if (assigneeId) return assigneeId;
    if (!assigneeEmail) return undefined;
    const wanted = assigneeEmail.toLowerCase();
    const agents = await this.chatwoot.listAgents(accountId);
    const match = agents.find(agent => String(agent.email || '').toLowerCase() === wanted);
    if (!match?.id) throw new ValidationError('assignee_not_found', `No Chatwoot agent found for ${assigneeEmail}`);
    return positiveInt(match.id, 'assignee_id');
  }

  async resolveContact(input) {
    if (input.contactId) return { id: input.contactId };
    if (input.contact.email) {
      const matches = await this.chatwoot.searchContacts(input.accountId, input.contact.email).catch(() => []);
      const found = matches.find(contact => String(contact.email || '').toLowerCase() === input.contact.email.toLowerCase());
      if (found?.id) return found;
    }
    const created = await this.chatwoot.createContact(input.accountId, {
      inboxId: input.inboxId,
      name: input.contact.name,
      email: input.contact.email,
      phoneNumber: input.contact.phoneNumber,
      identifier: input.contact.identifier,
      customAttributes: input.contact.customAttributes
    });
    if (!created?.id) throw new Error('chatwoot contact id missing');
    return created;
  }

  async applyTicketMetadata(accountId, conversationId, { action, priority, category, labels = [] }) {
    const prefix = this.config.tickets.labelPrefix;
    const nextLabels = [
      prefix,
      `${prefix}_${action}`,
      priority && priority !== 'normal' ? `${prefix}_${priority}` : '',
      category ? `${prefix}_${category}` : '',
      ...labels
    ].filter(Boolean);
    await this.chatwoot.addLabels(accountId, conversationId, nextLabels).catch(() => null);
  }
}

export function normalizeListOptions(raw = {}, cfg = {}) {
  return {
    accountId: accountIdFrom(raw.account_id ?? raw.accountId, cfg),
    page: boundedInt(raw.page, 1, 5000, 1),
    status: statusFrom(raw.status, 'all', true),
    inboxId: optionalPositiveInt(raw.inbox_id ?? raw.inboxId, 'inbox_id'),
    teamId: optionalPositiveInt(raw.team_id ?? raw.teamId, 'team_id'),
    assigneeType: oneOf(cleanText((raw.assignee_type ?? raw.assigneeType) || 'all'), ASSIGNEE_TYPES, 'assignee_type'),
    q: cleanText(raw.q).slice(0, 200),
    labels: labelList(raw.labels)
  };
}

export function normalizeCreateTicket(raw = {}, cfg = {}) {
  const content = cleanText(raw.content ?? raw.message ?? raw.body).slice(0, cfg.maxContentChars || 8000);
  if (!content) throw new ValidationError('content_required');
  const contact = normalizeContact(raw.contact || raw);
  const contactId = optionalPositiveInt(raw.contact_id ?? raw.contactId, 'contact_id');
  if (!contactId && !contact.email && !contact.phoneNumber && !contact.identifier) {
    throw new ValidationError('contact_required');
  }
  const inboxId = optionalPositiveInt(raw.inbox_id ?? raw.inboxId, 'inbox_id') || cfg.inboxId;
  if (!inboxId) throw new ValidationError('inbox_id_required');

  return {
    accountId: accountIdFrom(raw.account_id ?? raw.accountId, cfg),
    inboxId,
    contactId,
    contact,
    sourceId: cleanText(raw.source_id ?? raw.sourceId),
    subject: cleanText(raw.subject ?? raw.asunto).slice(0, 200),
    content,
    status: statusFrom(raw.status, 'open', false),
    priority: priorityFrom(raw.priority),
    category: cleanLabel(raw.category ?? raw.categoria),
    labels: labelList(raw.labels),
    assigneeId: optionalPositiveInt(raw.assignee_id ?? raw.assigneeId, 'assignee_id'),
    assigneeEmail: emailFrom(raw.assignee_email ?? raw.assigneeEmail ?? raw.responsible_email ?? raw.responsibleEmail),
    teamId: optionalPositiveInt(raw.team_id ?? raw.teamId, 'team_id'),
    note: cleanText(raw.note ?? raw.private_note ?? raw.privateNote).slice(0, 2000)
  };
}

export function normalizeTicketAction(raw = {}, cfg = {}) {
  return {
    accountId: accountIdFrom(raw.account_id ?? raw.accountId, cfg),
    labels: labelList(raw.labels),
    note: cleanText(raw.note ?? raw.private_note ?? raw.privateNote).slice(0, 2000)
  };
}

export function normalizeEscalation(raw = {}, cfg = {}) {
  return {
    ...normalizeTicketAction(raw, cfg),
    assigneeId: optionalPositiveInt(raw.assignee_id ?? raw.assigneeId, 'assignee_id'),
    assigneeEmail: emailFrom(raw.assignee_email ?? raw.assigneeEmail ?? raw.responsible_email ?? raw.responsibleEmail),
    teamId: optionalPositiveInt(raw.team_id ?? raw.teamId, 'team_id'),
    priority: priorityFrom(raw.priority || 'urgent'),
    category: cleanLabel(raw.category ?? raw.categoria)
  };
}

function accountIdFrom(value, cfg) {
  const id = optionalPositiveInt(value, 'account_id') || cfg.accountId;
  if (!id) throw new ValidationError('account_id_required');
  return id;
}

function normalizeContact(raw = {}) {
  return {
    name: cleanText(raw.name ?? raw.nombre).slice(0, 120),
    email: emailFrom(raw.email),
    phoneNumber: cleanText(raw.phone_number ?? raw.phoneNumber ?? raw.telefono).slice(0, 40),
    identifier: cleanText(raw.identifier ?? raw.identificador).slice(0, 120),
    customAttributes: typeof raw.custom_attributes === 'object' && raw.custom_attributes !== null
      ? raw.custom_attributes
      : typeof raw.customAttributes === 'object' && raw.customAttributes !== null
        ? raw.customAttributes
        : {}
  };
}

function statusFrom(value, fallback, allowAll) {
  const normalized = normalizeStatus(value || fallback);
  const allowed = allowAll ? STATUSES : CREATE_STATUSES;
  return oneOf(normalized, allowed, 'status');
}

function normalizeStatus(value) {
  const status = cleanText(value).toLowerCase();
  if (status === 'closed' || status === 'cerrado' || status === 'cerrada') return 'resolved';
  if (status === 'abierto' || status === 'abierta') return 'open';
  return status;
}

function priorityFrom(value) {
  const priority = cleanText(value || 'normal').toLowerCase();
  return oneOf(priority, PRIORITIES, 'priority');
}

function oneOf(value, allowed, field) {
  if (!allowed.has(value)) throw new ValidationError(`${field}_invalid`);
  return value;
}

function positiveInt(value, field) {
  const id = optionalPositiveInt(value, field);
  if (!id) throw new ValidationError(`${field}_required`);
  return id;
}

function optionalPositiveInt(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  const id = Number.parseInt(value, 10);
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError(`${field}_invalid`);
  return id;
}

function boundedInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function emailFrom(value) {
  const email = cleanText(value).toLowerCase();
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('email_invalid');
  return email;
}

function labelList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return Array.from(new Set(raw.map(cleanLabel).filter(Boolean))).slice(0, 20);
}

function cleanLabel(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function sourceIdFor(contact, inboxId) {
  const inbox = (contact.contact_inboxes || []).find(item => Number(item?.inbox?.id) === Number(inboxId));
  return inbox?.source_id || '';
}

function conversationIdFrom(conversation) {
  return Number(conversation?.id || conversation?.payload?.id || conversation?.data?.id) || 0;
}

function compactConversation(conversation = {}) {
  const assignee = conversation.assignee || conversation.meta?.assignee || null;
  const team = conversation.team || conversation.meta?.team || null;
  return {
    id: conversationIdFrom(conversation),
    display_id: conversation.display_id,
    status: conversation.status,
    priority: conversation.priority,
    inbox_id: conversation.inbox_id,
    contact_id: conversation.contact_id || conversation.meta?.sender?.id,
    assignee: assignee ? compactAgent(assignee) : null,
    team: team ? compactTeam(team) : null,
    labels: conversation.labels || [],
    last_activity_at: conversation.last_activity_at,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at
  };
}

function compactAssignment({ assigneeId, assigneeEmail, teamId }) {
  return {
    assignee_id: assigneeId || null,
    assignee_email: assigneeEmail || null,
    team_id: teamId || null,
    notification: 'chatwoot_assignment'
  };
}

function compactAgent(agent = {}) {
  return {
    id: Number(agent.id || agent.user_id) || 0,
    name: agent.name || agent.available_name || agent.display_name || '',
    email: agent.email || '',
    role: agent.role || '',
    availability_status: agent.availability_status || ''
  };
}

function compactTeam(team = {}) {
  return {
    id: Number(team.id) || 0,
    name: team.name || '',
    description: team.description || '',
    allow_auto_assign: Boolean(team.allow_auto_assign)
  };
}

function compactInbox(inbox = {}) {
  return {
    id: Number(inbox.id) || 0,
    name: inbox.name || '',
    channel_type: inbox.channel_type || inbox.channel?.type || '',
    email_address: inbox.email_address || inbox.channel?.email || '',
    enable_auto_assignment: Boolean(inbox.enable_auto_assignment)
  };
}

function buildTicketNote(title, body) {
  return [
    '**Mindbliss Ticket Ops**',
    '',
    title,
    '',
    cleanText(body)
  ].filter(Boolean).join('\n');
}
