import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKnowledgePayload, isKnowledgeCommandWebhook, parseKnowledgeCommand } from '../src/knowledgeCommand.js';

test('parses private kb command with metadata', () => {
  const command = parseKnowledgeCommand(`#kb Reenvio de OTP
Categoria: auth
Tags: otp, telefono
Pregunta: El usuario no recibe codigo OTP.
Respuesta: Validar telefono, correo y usar reenvio por SMS si el correo falla.`);

  assert.equal(command.valid, true);
  assert.equal(command.title, 'Reenvio de OTP');
  assert.equal(command.category, 'auth');
  assert.deepEqual(command.tags, ['otp', 'telefono']);
  assert.match(command.content, /reenvio por SMS/);
});

test('detects only private Chatwoot knowledge commands', () => {
  assert.equal(isKnowledgeCommandWebhook({
    event: 'message_created',
    private: true,
    content_type: 'text',
    content: '#memoria Validar pago exitoso antes de posicionar en arbol binario.'
  }), true);
  assert.equal(isKnowledgeCommandWebhook({
    event: 'message_created',
    private: false,
    content_type: 'text',
    content: '#kb texto publico'
  }), false);
});

test('builds account-scoped knowledge payload', () => {
  const command = parseKnowledgeCommand('#kb OTP\nEl codigo OTP por SMS se debe solicitar cuando falla el correo.');
  const payload = buildKnowledgePayload({
    id: 77,
    account: { id: 2 },
    conversation: { id: 15 },
    sender: { email: 'agent@example.com' }
  }, command, 'kb:77');

  assert.equal(payload.source, 'chatwoot_kb_note');
  assert.equal(payload.kb_scope, 'account');
  assert.equal(payload.kb_title, 'OTP');
  assert.equal(payload.sender.identifier, 'kb:account:2');
});
