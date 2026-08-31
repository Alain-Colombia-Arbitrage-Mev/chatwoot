import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSupportPrompt,
  classifySupportText,
  shouldProcessWebhook,
} from '../src/triage.js';

test('detects support category and priority', () => {
  assert.deepEqual(
    classifySupportText('No puedo validar mi codigo OTP del telefono').support,
    true
  );
  assert.equal(
    classifySupportText('No puedo validar mi codigo OTP del telefono').category,
    'auth'
  );
  assert.equal(
    classifySupportText('Tengo un cargo no reconocido en mi tarjeta').priority,
    'urgent'
  );
});

test('ignores non support content', () => {
  assert.equal(
    classifySupportText('Tenemos una propuesta comercial de publicidad')
      .support,
    false
  );
});

test('processes only incoming public message_created events', () => {
  assert.equal(
    shouldProcessWebhook({
      event: 'message_created',
      private: false,
      message_type: 'incoming',
      content_type: 'text',
      content: 'Mi pago no activa el arbol',
    }),
    true
  );
  assert.equal(
    shouldProcessWebhook({
      event: 'message_created',
      private: true,
      message_type: 'incoming',
      content_type: 'text',
      content: 'nota privada',
    }),
    false
  );
});

test('support prompt requests missing intake data and redacts long numbers', () => {
  const prompt = buildSupportPrompt(
    {
      content: 'No llega el codigo OTP al telefono 3001234567',
      conversation: { id: 15, custom_attributes: {} },
      sender: {},
    },
    {
      category: 'auth',
      priority: 'high',
    },
    []
  );

  assert.match(prompt, /Datos faltantes: nombre completo, telefono o WhatsApp/);
  assert.match(prompt, /telefono \[numero-redactado\]/);
  assert.doesNotMatch(prompt, /3001234567/);
});
