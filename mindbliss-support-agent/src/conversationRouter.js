import { cleanText } from './triage.js';

const ROUTING_SOURCE = 'mindbliss_conversation_router';
const SUPPORT_ROUTE_REASON_LIMIT = 500;

export class ConversationRouter {
  constructor(config = {}, deps = {}) {
    this.config = {
      enabled: config.enabled !== false,
      defaultTeamId: positiveInt(config.defaultTeamId),
      defaultAssigneeEmail: emailFrom(config.defaultAssigneeEmail),
      priorityTeamMap: config.priorityTeamMap || {},
      stickyReturningAgent: config.stickyReturningAgent !== false,
      preferAvailableAgents: config.preferAvailableAgents !== false,
      allowedAgentRoles: Array.isArray(config.allowedAgentRoles)
        ? config.allowedAgentRoles.map(role => cleanText(role).toLowerCase()).filter(Boolean)
        : ['agent']
    };
    this.chatwoot = deps.chatwoot;
    this.rules = parseRoutingRules(config.rules);
  }

  async route({
    accountId,
    conversationId,
    payload = {},
    triage = {},
    supportResult = {},
    labels = []
  } = {}) {
    if (!this.config.enabled) {
      return routeResult({
        enabled: false,
        status: 'disabled',
        strategy: 'disabled',
        reason: 'support_routing_disabled',
        triage,
        supportResult
      });
    }

    const conversation = await this.loadConversation(accountId, conversationId, payload);
    const current = currentAssignment(conversation, payload);
    if (this.config.stickyReturningAgent && current.assigneeId) {
      return routeResult({
        status: 'kept',
        strategy: 'sticky_current_assignee',
        reason: 'conversation_already_has_human_assignee',
        teamId: current.teamId,
        assigneeId: current.assigneeId,
        assigneeEmail: current.assigneeEmail,
        assignmentRequired: false,
        confidence: 1,
        triage,
        supportResult
      });
    }

    const context = routingContext({ payload, triage, labels });
    const match = bestRule(this.rules, context);
    const agent = await this.selectAgent(accountId, match?.rule);
    const teamId =
      positiveInt(match?.rule?.teamId) ||
      this.config.defaultTeamId ||
      positiveInt(this.config.priorityTeamMap[cleanText(triage.priority).toLowerCase()]);
    const strategy = match?.rule
      ? 'routing_rule'
      : teamId
        ? 'default_or_priority_team'
        : agent.id
          ? 'default_agent'
          : 'unrouted';
    const reason = match?.rule
      ? [`matched_rule:${match.rule.name}`, agent.reason].filter(Boolean).join(';')
      : agent.reason || (teamId ? 'matched_default_team' : 'no_matching_route');

    return routeResult({
      status: teamId || agent.id ? 'routed' : 'unrouted',
      strategy,
      ruleName: match?.rule?.name || '',
      reason,
      teamId,
      assigneeId: agent.id,
      assigneeEmail: agent.email,
      confidence: match ? Math.min(0.99, match.score / 100) : teamId || agent.id ? 0.5 : 0,
      triage,
      supportResult
    });
  }

  async apply(accountId, conversationId, route, { triage = {}, supportResult = {} } = {}) {
    if (!route?.enabled || !this.chatwoot) return route;

    if (route.assignmentRequired !== false) {
      if (route.teamId && this.chatwoot.assignTeam) {
        await this.chatwoot.assignTeam(accountId, conversationId, route.teamId).catch(error => {
          warn('support_route_team_assignment_failed', conversationId, error);
        });
      }

      if (route.assigneeId && this.chatwoot.assignConversation) {
        await this.chatwoot.assignConversation(accountId, conversationId, {
          assigneeId: route.assigneeId
        }).catch(error => {
          warn('support_route_agent_assignment_failed', conversationId, error);
        });
      }
    }

    if (this.chatwoot.updateConversationCustomAttributes) {
      await this.chatwoot.updateConversationCustomAttributes(
        accountId,
        conversationId,
        routingAttributes(route, { triage, supportResult }),
        { merge: true }
      ).catch(error => {
        warn('support_route_metadata_failed', conversationId, error);
      });
    }

    return route;
  }

  async loadConversation(accountId, conversationId, payload) {
    if (!this.chatwoot?.getConversation || !accountId || !conversationId) {
      return payload.conversation || {};
    }
    return this.chatwoot.getConversation(accountId, conversationId).catch(() => payload.conversation || {});
  }

  async selectAgent(accountId, rule = null) {
    const requestedAgents = [
      ...agentTargetsFromRule(rule),
      ...(this.config.defaultAssigneeEmail ? [{ email: this.config.defaultAssigneeEmail }] : [])
    ];
    if (requestedAgents.length === 0) return { id: null, email: '', reason: '' };

    const agents = await this.chatwoot?.listAgents?.(accountId).catch(error => {
      warn('support_route_agents_lookup_failed', 0, error);
      return [];
    });
    const list = Array.isArray(agents) ? agents : [];
    const matches = [];

    for (const target of requestedAgents) {
      const match = resolveAgentTarget(target, list);
      if (!match || !agentRoleAllowed(match, this.config.allowedAgentRoles)) continue;
      matches.push(match);
    }

    const agent = selectPreferredAgent(matches, this.config.preferAvailableAgents);
    if (!agent) return { id: null, email: '', reason: 'no_assignable_agent_found' };

    return {
      id: agentId(agent),
      email: cleanText(agent.email).toLowerCase(),
      reason: agent.availability_status
        ? `matched_agent:${agent.availability_status}`
        : 'matched_agent'
    };
  }
}

export function parseRoutingRules(value) {
  if (Array.isArray(value)) return normalizeRules(value);
  const text = String(value || '').trim();
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`SUPPORT_ROUTING_RULES must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('SUPPORT_ROUTING_RULES must be a JSON array');
  return normalizeRules(parsed);
}

export function buildRoutingNote(route = {}) {
  if (!route.enabled) return 'Routing automatico: desactivado.';
  const lines = [
    'Routing automatico:',
    `- Estado: ${route.status || 'unknown'}`,
    route.ruleName ? `- Regla: ${route.ruleName}` : '',
    route.teamId ? `- Equipo ID: ${route.teamId}` : '',
    route.assigneeEmail ? `- Responsable: ${route.assigneeEmail}` : route.assigneeId ? `- Responsable ID: ${route.assigneeId}` : '',
    route.reason ? `- Motivo: ${route.reason}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

function normalizeRules(rules) {
  return rules.map(normalizeRule).filter(Boolean).slice(0, 50);
}

function normalizeRule(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    name: cleanLabel(raw.name || raw.nombre || `rule_${index + 1}`),
    categories: stringList(raw.categories ?? raw.category ?? raw.categorias),
    priorities: stringList(raw.priorities ?? raw.priority ?? raw.prioridades),
    labels: stringList(raw.labels ?? raw.label ?? raw.etiquetas).map(cleanLabel).filter(Boolean),
    keywords: stringList(raw.keywords ?? raw.keyword ?? raw.palabras)
      .map(value => cleanText(value).toLowerCase())
      .filter(Boolean)
      .slice(0, 25),
    teamId: positiveInt(raw.team_id ?? raw.teamId),
    agentEmails: stringList(
      raw.agent_emails ??
        raw.agentEmails ??
        raw.assignee_emails ??
        raw.assigneeEmails ??
        raw.assignee_email
    ).map(emailFrom).filter(Boolean),
    agentIds: stringList(
      raw.agent_ids ?? raw.agentIds ?? raw.assignee_ids ?? raw.assigneeIds ?? raw.assignee_id
    ).map(positiveInt).filter(Boolean)
  };
}

function bestRule(rules, context) {
  return rules
    .map((rule, index) => ({ rule, index, score: ruleScore(rule, context) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0] || null;
}

function ruleScore(rule, context) {
  let score = 0;
  let constrained = false;
  if (rule.categories.length > 0) {
    constrained = true;
    if (!rule.categories.includes(context.category)) return 0;
    score += 45;
  }
  if (rule.priorities.length > 0) {
    constrained = true;
    if (!rule.priorities.includes(context.priority)) return 0;
    score += 25;
  }
  if (rule.labels.length > 0) {
    constrained = true;
    const labelHit = rule.labels.some(label => context.labels.includes(label));
    if (!labelHit) return 0;
    score += 15;
  }
  if (rule.keywords.length > 0) {
    constrained = true;
    const keywordHits = rule.keywords.filter(keyword => context.text.includes(keyword)).length;
    if (keywordHits === 0) return 0;
    score += 5 + keywordHits;
  }

  return constrained ? score : 1;
}

function routingContext({ payload, triage, labels }) {
  const conversation = payload.conversation || {};
  const attrs = conversation.custom_attributes || payload.custom_attributes || {};
  return {
    category: cleanText(triage.category).toLowerCase(),
    priority: cleanText(triage.priority).toLowerCase(),
    labels: Array.from(new Set([
      ...labelList(labels),
      ...labelList(payload.labels),
      ...labelList(conversation.labels)
    ])),
    text: [
      payload.content,
      payload.subject,
      conversation.additional_attributes?.mail_subject,
      attrs.initial_problem_description,
      attrs.problem_description
    ].map(value => cleanText(value).toLowerCase()).filter(Boolean).join(' ')
  };
}

function routeResult({
  enabled = true,
  status,
  strategy,
  ruleName = '',
  reason,
  teamId = null,
  assigneeId = null,
  assigneeEmail = '',
  assignmentRequired = true,
  confidence = 0,
  triage = {},
  supportResult = {}
}) {
  return {
    enabled,
    status,
    strategy,
    ruleName,
    reason,
    teamId: positiveInt(teamId) || null,
    assigneeId: positiveInt(assigneeId) || null,
    assigneeEmail: emailFrom(assigneeEmail),
    assignmentRequired,
    confidence,
    category: cleanText(triage.category).toLowerCase(),
    priority: cleanText(triage.priority).toLowerCase(),
    escalated: Boolean(supportResult.escalate)
  };
}

function routingAttributes(route, { triage, supportResult }) {
  const routedAt = new Date().toISOString();
  const attrs = {
    support_routing_enabled: Boolean(route.enabled),
    support_routing_source: ROUTING_SOURCE,
    support_routing_status: route.status,
    support_routing_strategy: route.strategy,
    support_routing_rule: route.ruleName || null,
    support_routing_reason: route.reason || null,
    support_routing_confidence: route.confidence,
    support_routing_category: route.category || cleanText(triage.category).toLowerCase() || null,
    support_routing_priority: route.priority || cleanText(triage.priority).toLowerCase() || null,
    support_routing_team_id: route.teamId || null,
    support_routing_assignee_id: route.assigneeId || null,
    support_routing_assignee_email: route.assigneeEmail || null,
    support_routed_at: routedAt
  };

  if (supportResult.escalate) {
    attrs.support_escalated = true;
    attrs.support_escalation_state = 'escalated';
    attrs.support_escalation_source = ROUTING_SOURCE;
    attrs.support_escalation_updated_at = routedAt;
    attrs.support_resolution_reviewed = true;
    attrs.support_resolution_reviewed_at = routedAt;
    attrs.support_resolution_review_source = ROUTING_SOURCE;
    attrs.support_resolution_complete = false;
    attrs.support_conversation_ended = false;
    attrs.support_resolution_reason = cleanText(
      supportResult.answer || triage.reason || 'AI requested human escalation'
    ).slice(0, SUPPORT_ROUTE_REASON_LIMIT);
  }

  return attrs;
}

function currentAssignment(conversation = {}, payload = {}) {
  const sourceConversation = conversation || {};
  const payloadConversation = payload.conversation || {};
  const assigneeType =
    sourceConversation.meta?.assignee_type ||
    sourceConversation.assignee_type ||
    payloadConversation.meta?.assignee_type ||
    payloadConversation.assignee_type ||
    '';
  const assignee =
    sourceConversation.meta?.assignee ||
    sourceConversation.assignee ||
    payloadConversation.meta?.assignee ||
    payloadConversation.assignee ||
    null;
  const team =
    sourceConversation.meta?.team ||
    sourceConversation.team ||
    payloadConversation.meta?.team ||
    payloadConversation.team ||
    null;

  const isHuman = !assigneeType || String(assigneeType).toLowerCase() === 'user';
  const assigneeEmail = cleanText(assignee?.email).toLowerCase();
  return {
    assigneeId: isHuman && assigneeEmail ? agentId(assignee) : null,
    assigneeEmail,
    teamId: positiveInt(team?.id)
  };
}

function agentTargetsFromRule(rule) {
  if (!rule) return [];
  return [
    ...rule.agentIds.map(id => ({ id })),
    ...rule.agentEmails.map(email => ({ email }))
  ];
}

function resolveAgentTarget(target, agents) {
  if (target.id) {
    return agents.find(agent => agentId(agent) === target.id) || null;
  }
  if (!target.email) return null;
  const wanted = target.email.toLowerCase();
  return agents.find(agent => cleanText(agent.email).toLowerCase() === wanted) || null;
}

function selectPreferredAgent(agents, preferAvailable) {
  if (!agents.length) return null;
  if (!preferAvailable) return agents[0];
  return [...agents].sort((a, b) => availabilityRank(b) - availabilityRank(a))[0];
}

function availabilityRank(agent) {
  const status = cleanText(agent.availability_status).toLowerCase();
  if (status === 'online') return 3;
  if (status === 'busy') return 2;
  if (status === 'offline') return 0;
  return 1;
}

function agentRoleAllowed(agent, allowedRoles) {
  if (agent.confirmed === false) return false;
  if (!allowedRoles.length) return true;
  const role = cleanText(agent.role).toLowerCase();
  return !role || allowedRoles.includes(role);
}

function agentId(agent = {}) {
  agent = agent || {};
  return positiveInt(agent.id || agent.user_id);
}

function positiveInt(value) {
  const id = Number.parseInt(value, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(item => cleanText(item).toLowerCase()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return String(value).split(',').map(item => cleanText(item).toLowerCase()).filter(Boolean);
}

function labelList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw.map(cleanLabel).filter(Boolean);
}

function emailFrom(value) {
  const email = cleanText(value).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
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

function warn(msg, conversationId, error) {
  console.warn(JSON.stringify({
    level: 'warn',
    msg,
    conversationId: conversationId || undefined,
    error: error.message
  }));
}
