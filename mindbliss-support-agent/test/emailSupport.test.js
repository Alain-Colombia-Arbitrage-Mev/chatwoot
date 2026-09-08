import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailSupportProcessor, isEmailWebhook } from '../src/emailSupport.js';

function fixture() {
  const calls = [];
  const route = { accountId: 2, inboxId: 3, teamId: 1, botId: 1, companyName: 'Company Two' };
  const incoming = {
    id: 77, message_type: 0, private: false, content: 'Como doy seguimiento a mi solicitud?',
    content_attributes: { email: { auto_reply: false, from: ['customer@example.com'] } }
  };
  const conversation = { id: 12, inbox_id: 3, status: 'pending', custom_attributes: {}, meta: { assignee_type: 'AgentBot', assignee: { id: 1 } } };
  const messages = [incoming];
  const knowledge = [{ rerank_score: 0.98, payload: { account_id: 2, kb_scope: 'account', content: 'Responde al mismo correo e incluye el numero de caso.' } }];
  const chatwoot = {
    getInbox: async () => ({ id: 3, channel_type: 'Channel::Email' }),
    getConversation: async () => conversation,
    recentMessages: async () => [...messages],
    listTeamMembers: async () => [
      { id: 2, role: 'administrator', confirmed: true },
      { id: 6, role: 'agent', confirmed: false },
      { id: 5, role: 'agent', confirmed: true, availability_status: 'online' }
    ],
    assignTeam: async (...args) => calls.push(['team', ...args]),
    assignConversation: async (...args) => calls.push(['assign', ...args]),
    setPriority: async () => {},
    openConversation: async () => { conversation.status = 'open'; },
    createMessage: async (_accountId, _conversationId, options) => {
      calls.push(['message', options]);
      messages.push({ id: 100 + messages.length, message_type: 1, private: options.privateMessage,
        content: options.content, content_attributes: options.contentAttributes });
    },
    hasNoteMarker: async (_accountId, _conversationId, marker) => messages.some(m => m.private && m.content.includes(marker)),
    addLabels: async (...args) => calls.push(['labels', ...args]),
    updateConversationCustomAttributes: async (_accountId, _conversationId, attrs) => Object.assign(conversation.custom_attributes, attrs)
  };
  const memory = { approvedKnowledge: async () => knowledge };
  const supportBrain = { selectEmailKnowledge: async (_query, hits) => hits[0] || null };
  const processor = new EmailSupportProcessor({ routes: [route] }, { chatwoot, memory, supportBrain });
  const payload = { event: 'message_created', id: 77, message_type: 'incoming', private: false,
    content_type: 'incoming_email', account: { id: 2 }, inbox: { id: 3 }, conversation: { id: 12, channel: 'Channel::Email' } };
  return { processor, payload, calls, messages, incoming, conversation, knowledge, chatwoot, memory, supportBrain };
}

test('email uses approved content and assigns only a confirmed support agent', async () => {
  const f = fixture();
  const result = await f.processor.process(f.payload);
  assert.equal(result.status, 'email_knowledge_replied');
  const reply = f.calls.find(c => c[0] === 'message' && !c[1].privateMessage)[1];
  assert.match(reply.content, /Company Two/);
  assert.match(reply.content, /Responde al mismo correo/);
  assert.equal(reply.botId, 1);
  assert.equal(reply.contentAttributes.email_support.incoming_message_id, 77);
  assert.deepEqual(f.calls.find(c => c[0] === 'assign').slice(1), [2, 12, { assigneeId: 5 }]);
  assert.equal(f.conversation.status, 'open');
  assert.equal(f.conversation.custom_attributes.email_support_human_review_required, true);
  assert.equal(f.conversation.custom_attributes.support_resolution_complete, false);
});

test('unknown questions get a receipt without inventing an answer', async () => {
  const f = fixture();
  f.incoming.content = 'Tengo una duda';
  f.memory.approvedKnowledge = async () => [];
  const result = await f.processor.process(f.payload);
  assert.equal(result.status, 'email_acknowledged');
  assert.match(f.calls.find(c => c[0] === 'message')[1].content, /quedo en la bandeja/);
});

test('sensitive account and payment cases do not ask the LLM', async () => {
  const f = fixture();
  f.incoming.content = 'No puedo entrar y necesito un reembolso';
  f.supportBrain.selectEmailKnowledge = async () => { throw new Error('must not call'); };
  const result = await f.processor.process(f.payload);
  assert.equal(result.reason, 'sensitive_case');
  assert.equal(result.status, 'email_acknowledged');
});

test('memory outage sends a generic receipt and leaves the case open', async () => {
  const f = fixture();
  f.memory.approvedKnowledge = async () => { throw new Error('unavailable'); };
  const result = await f.processor.process(f.payload);
  assert.equal(result.reason, 'knowledge_service_unavailable');
  assert.equal(f.conversation.status, 'open');
});

test('another company and another inbox cannot trigger email automation', async () => {
  const f = fixture();
  assert.equal((await f.processor.process({ ...f.payload, account: { id: 3 } })).reason, 'email_inbox_not_enabled');
  assert.equal((await f.processor.process({ ...f.payload, inbox: { id: 2 } })).reason, 'email_inbox_not_enabled');
  f.conversation.inbox_id = 9;
  assert.equal((await f.processor.process(f.payload)).reason, 'email_inbox_mismatch');
  assert.equal(f.calls.length, 0);
});

test('low relevance and foreign memory never become public replies', async () => {
  const f = fixture();
  f.knowledge.push({ rerank_score: 1, payload: { account_id: 3, content: 'Foreign secret' } });
  f.knowledge[0].rerank_score = 0.1;
  assert.equal((await f.processor.process(f.payload)).status, 'email_acknowledged');
  assert.doesNotMatch(f.calls.find(c => c[0] === 'message')[1].content, /Foreign secret/);
});

test('a fabricated LLM result cannot supply arbitrary answer text', async () => {
  const f = fixture();
  f.supportBrain.selectEmailKnowledge = async () => ({ payload: { content: 'Invented refund promise' } });
  assert.equal((await f.processor.process(f.payload)).status, 'email_acknowledged');
});

test('replayed and concurrent webhook deliveries send only one automatic email', async () => {
  const f = fixture();
  await Promise.all([f.processor.process(f.payload), f.processor.process(f.payload)]);
  await f.processor.process(f.payload);
  assert.equal(f.calls.filter(c => c[0] === 'message' && !c[1].privateMessage).length, 1);
});

test('handoff recovers after a persisted email without sending it twice', async () => {
  const f = fixture();
  f.messages.push({ id: 90, message_type: 1, private: false, content_attributes: { email_support: {
    incoming_message_id: 77, kind: 'acknowledgement', reason: 'no_approved_knowledge'
  } } });
  assert.equal((await f.processor.process(f.payload)).status, 'email_handoff_recovered');
  assert.equal(f.calls.filter(c => c[0] === 'message' && !c[1].privateMessage).length, 0);
  assert.equal(f.conversation.custom_attributes.email_support_processed_id, 77);
});

for (const sender of ['mailer-daemon@example.com', 'postmaster@example.com', 'noreply@example.com']) {
  test(`does not reply to ${sender}`, async () => {
    const f = fixture();
    f.incoming.content_attributes.email.from = [sender];
    assert.equal((await f.processor.process(f.payload)).reason, 'automated_or_unverified_email');
    assert.equal(f.calls.length, 0);
  });
}

test('auto replies and missing email metadata fail closed', async () => {
  const f = fixture();
  f.incoming.content_attributes.email.auto_reply = true;
  assert.equal((await f.processor.process(f.payload)).reason, 'automated_or_unverified_email');
  delete f.incoming.content_attributes.email;
  assert.equal((await f.processor.process(f.payload)).reason, 'automated_or_unverified_email');
});

test('does not interrupt a human response, even outside the recent message window', async () => {
  const f = fixture();
  f.conversation.first_reply_created_at = 123;
  assert.equal((await f.processor.process(f.payload)).reason, 'human_already_responded');
  assert.equal(f.calls.length, 0);
});

test('a human answering while the model runs cancels the automatic reply', async () => {
  const f = fixture();
  f.supportBrain.selectEmailKnowledge = async (_query, hits) => {
    f.messages.push({ id: 90, message_type: 1, private: false, content: 'Agent response' });
    return hits[0];
  };
  assert.equal((await f.processor.process(f.payload)).reason, 'conversation_changed');
  assert.equal(f.calls.length, 0);
});

test('email status events stay out of automatic resolution training', () => {
  assert.equal(isEmailWebhook({ event: 'conversation_resolved', channel: 'Channel::Email' }), true);
  assert.equal(isEmailWebhook({ event: 'message_created', conversation: { channel: 'Channel::Email' } }), true);
  assert.equal(isEmailWebhook({ content_type: 'text', conversation: { channel: 'Channel::WebWidget' } }), false);
});
