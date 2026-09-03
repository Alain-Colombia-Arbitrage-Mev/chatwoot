import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRoutingNote,
  ConversationRouter,
  parseRoutingRules,
} from '../src/conversationRouter.js';

test('routes by category and priority, preferring available support agents', async () => {
  const calls = [];
  const chatwoot = {
    listAgents: async () => [
      {
        id: 8,
        email: 'offline@example.com',
        role: 'agent',
        availability_status: 'offline',
      },
      {
        id: 9,
        email: 'online@example.com',
        role: 'agent',
        availability_status: 'online',
      },
    ],
    assignTeam: async (...args) => calls.push(['team', ...args]),
    assignConversation: async (...args) => calls.push(['assign', ...args]),
    updateConversationCustomAttributes: async (...args) =>
      calls.push(['attrs', ...args]),
  };
  const router = new ConversationRouter(
    {
      rules: [
        {
          name: 'auth-high',
          categories: ['auth'],
          priorities: ['high', 'urgent'],
          team_id: 12,
          agent_emails: ['offline@example.com', 'online@example.com'],
        },
      ],
      allowedAgentRoles: ['agent'],
    },
    { chatwoot }
  );

  const route = await router.route({
    accountId: 2,
    conversationId: 15,
    payload: { content: 'No llega el codigo OTP' },
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Revisar OTP.', escalate: true },
  });
  await router.apply(2, 15, route, {
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Revisar OTP.', escalate: true },
  });

  assert.equal(route.status, 'routed');
  assert.equal(route.ruleName, 'auth-high');
  assert.equal(route.teamId, 12);
  assert.equal(route.assigneeId, 9);
  assert.equal(route.assigneeEmail, 'online@example.com');
  assert.equal(calls.some(call => call[0] === 'team' && call[3] === 12), true);
  assert.equal(
    calls.some(call => call[0] === 'assign' && call[3].assigneeId === 9),
    true
  );
  const attrsCall = calls.find(call => call[0] === 'attrs');
  assert.equal(attrsCall[3].support_escalated, true);
  assert.equal(attrsCall[3].support_escalation_state, 'escalated');
  assert.equal(attrsCall[4].merge, true);
  assert.match(buildRoutingNote(route), /Responsable: online@example.com/);
});

test('keeps current human assignee for returning conversations', async () => {
  const calls = [];
  const chatwoot = {
    getConversation: async () => ({
      meta: {
        assignee_type: 'User',
        assignee: { id: 7, email: 'same-agent@example.com' },
        team: { id: 4 },
      },
    }),
    listAgents: async () => {
      throw new Error('sticky route should not query agents');
    },
    assignTeam: async (...args) => calls.push(['team', ...args]),
    assignConversation: async (...args) => calls.push(['assign', ...args]),
    updateConversationCustomAttributes: async (...args) =>
      calls.push(['attrs', ...args]),
  };
  const router = new ConversationRouter(
    {
      rules: [{ name: 'auth', categories: ['auth'], team_id: 12 }],
      stickyReturningAgent: true,
    },
    { chatwoot }
  );

  const route = await router.route({
    accountId: 2,
    conversationId: 15,
    payload: { content: 'Volvi por el mismo caso' },
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Reviso el caso.', escalate: false },
  });
  await router.apply(2, 15, route, {
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Reviso el caso.', escalate: false },
  });

  assert.equal(route.status, 'kept');
  assert.equal(route.assigneeId, 7);
  assert.equal(route.teamId, 4);
  assert.equal(calls.some(call => call[0] === 'team'), false);
  assert.equal(calls.some(call => call[0] === 'assign'), false);
  const attrsCall = calls.find(call => call[0] === 'attrs');
  assert.equal(attrsCall[3].support_routing_strategy, 'sticky_current_assignee');
  assert.equal('support_escalated' in attrsCall[3], false);
});

test('does not assign administrators as support owners', async () => {
  const chatwoot = {
    listAgents: async () => [
      {
        id: 10,
        email: 'admin@example.com',
        role: 'administrator',
        availability_status: 'online',
      },
    ],
  };
  const router = new ConversationRouter(
    {
      rules: [
        {
          name: 'payments',
          categories: ['payments'],
          team_id: 22,
          agent_emails: ['admin@example.com'],
        },
      ],
      allowedAgentRoles: ['agent'],
    },
    { chatwoot }
  );

  const route = await router.route({
    accountId: 2,
    conversationId: 15,
    payload: { content: 'Tengo un problema con pago' },
    triage: { category: 'payments', priority: 'high' },
    supportResult: { answer: 'Se escala.', escalate: true },
  });

  assert.equal(route.teamId, 22);
  assert.equal(route.assigneeId, null);
  assert.match(route.reason, /no_assignable_agent_found/);
});

test('ignores agent bot assignment when selecting a human route', async () => {
  const chatwoot = {
    getConversation: async () => ({
      meta: {
        assignee_type: 'AgentBot',
        assignee: { id: 3, name: 'Mindbliss AI' },
      },
    }),
    listAgents: async () => [],
  };
  const router = new ConversationRouter(
    {
      rules: [{ name: 'auth', categories: ['auth'], team_id: 12 }],
      stickyReturningAgent: true,
    },
    { chatwoot }
  );

  const route = await router.route({
    accountId: 2,
    conversationId: 15,
    payload: { content: 'No llega OTP' },
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Se escala.', escalate: true },
  });

  assert.equal(route.status, 'routed');
  assert.equal(route.teamId, 12);
  assert.equal(route.strategy, 'routing_rule');
});

test('falls back to priority team map when no rule matches', async () => {
  const router = new ConversationRouter(
    {
      rules: [{ name: 'tree', categories: ['tree'], team_id: 14 }],
      priorityTeamMap: { high: 8 },
    },
    { chatwoot: { listAgents: async () => [] } }
  );

  const route = await router.route({
    accountId: 2,
    conversationId: 15,
    payload: { content: 'No llega el codigo OTP' },
    triage: { category: 'auth', priority: 'high' },
    supportResult: { answer: 'Revisar OTP.', escalate: true },
  });

  assert.equal(route.status, 'routed');
  assert.equal(route.teamId, 8);
  assert.equal(route.strategy, 'default_or_priority_team');
});

test('parses routing rules from JSON env', () => {
  const rules = parseRoutingRules(
    '[{"name":"retiros","categories":["withdrawals"],"keywords":["wallet"],"team_id":5}]'
  );

  assert.equal(rules.length, 1);
  assert.equal(rules[0].name, 'retiros');
  assert.deepEqual(rules[0].categories, ['withdrawals']);
  assert.equal(rules[0].teamId, 5);
});
