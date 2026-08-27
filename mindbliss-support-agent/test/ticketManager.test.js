import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TicketManager,
  ValidationError,
  normalizeCreateTicket,
  normalizeEscalation,
  normalizeListOptions
} from '../src/ticketManager.js';

test('normalizes ticket list filters and maps closed to resolved', () => {
  const opts = normalizeListOptions({
    status: 'closed',
    page: '2',
    assignee_type: 'assigned',
    labels: 'otp, pagos '
  }, { accountId: 2 });

  assert.equal(opts.accountId, 2);
  assert.equal(opts.status, 'resolved');
  assert.equal(opts.page, 2);
  assert.deepEqual(opts.labels, ['otp', 'pagos']);
});

test('requires contact and inbox when creating a ticket', () => {
  assert.throws(() => normalizeCreateTicket({
    account_id: 2,
    content: 'No llega OTP'
  }, {}), ValidationError);
});

test('creates a ticket and resolves assignee by email', async () => {
  const calls = [];
  const chatwoot = {
    listAgents: async () => [{ id: 9, email: 'agent@example.com', name: 'Agent' }],
    searchContacts: async () => [],
    createContact: async (...args) => {
      calls.push(['contact', ...args]);
      return {
        id: 44,
        email: 'cliente@example.com',
        contact_inboxes: [{ inbox: { id: 7 }, source_id: 'contact-source-44' }]
      };
    },
    createConversation: async (...args) => {
      calls.push(['conversation', ...args]);
      return { id: 77, status: 'open', priority: 'high' };
    },
    addLabels: async (...args) => calls.push(['labels', ...args]),
    assignConversation: async (...args) => calls.push(['assign', ...args])
  };
  const manager = new TicketManager({
    tickets: { accountId: 2, inboxId: 7, labelPrefix: 'mb_ticket', maxContentChars: 8000 },
    chatwoot: {}
  }, { chatwoot });

  const result = await manager.create({
    email: 'cliente@example.com',
    name: 'Cliente',
    content: 'No puedo validar el codigo OTP',
    priority: 'high',
    category: 'auth',
    assignee_email: 'agent@example.com'
  });

  assert.equal(result.status, 'ticket_created');
  assert.equal(result.assignment.assignee_id, 9);
  assert.equal(calls.some(call => call[0] === 'assign' && call[3].assigneeId === 9), true);
  assert.equal(calls.some(call => call[0] === 'labels' && call[3].includes('mb_ticket_created')), true);
});

test('closes a ticket with resolved status and private note', async () => {
  const calls = [];
  const chatwoot = {
    createMessage: async (...args) => calls.push(['message', ...args]),
    addLabels: async (...args) => calls.push(['labels', ...args]),
    closeConversation: async (...args) => {
      calls.push(['close', ...args]);
      return { id: 77, status: 'resolved' };
    }
  };
  const manager = new TicketManager({
    tickets: { accountId: 2, labelPrefix: 'mb_ticket' },
    chatwoot: {}
  }, { chatwoot });

  const result = await manager.close(77, { note: 'Caso verificado y resuelto.' });

  assert.equal(result.status, 'ticket_closed');
  assert.equal(result.ticket.id, 77);
  assert.equal(result.ticket.status, 'resolved');
  assert.equal(calls.some(call => call[0] === 'message' && call[3].privateMessage === true), true);
  assert.equal(calls.some(call => call[0] === 'close'), true);
});

test('escalation rejects unknown assignee email', async () => {
  const manager = new TicketManager({
    tickets: { accountId: 2, labelPrefix: 'mb_ticket' },
    chatwoot: {}
  }, {
    chatwoot: { listAgents: async () => [] }
  });

  assert.throws(() => normalizeEscalation({ priority: 'critical' }, { accountId: 2 }), ValidationError);
  await assert.rejects(
    () => manager.escalate(77, { assignee_email: 'missing@example.com' }),
    /No Chatwoot agent found/
  );
});
