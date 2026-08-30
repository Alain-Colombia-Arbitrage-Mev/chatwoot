import assert from 'node:assert/strict';
import test from 'node:test';
import { SupportBrain, pseudonymousUser } from '../src/supportBrain.js';

test('calls legacy Mindbliss support brain with service token', async () => {
  const calls = [];
  const brain = new SupportBrain({
    provider: 'mindbliss',
    url: 'http://mindbrain-vp-support:9096',
    token: 'support-token',
    timeoutMs: 1234
  }, {
    fetchJson: async (url, options) => {
      calls.push({ url, options });
      return { answer: 'Respuesta legacy.', escalate: false, sources: [] };
    }
  });

  const result = await brain.ask('Mensaje de soporte', 'cliente@example.com');

  assert.equal(result.answer, 'Respuesta legacy.');
  assert.equal(calls[0].url, 'http://mindbrain-vp-support:9096/api/support/chat');
  assert.equal(calls[0].options.timeoutMs, 1234);
  assert.equal(calls[0].options.headers['X-VP-Service-Token'], 'support-token');
  assert.equal(calls[0].options.headers['X-VP-User-Email'], 'cliente@example.com');
  assert.equal(calls[0].options.body.message, 'Mensaje de soporte');
});

test('calls OpenRouter with solar-pro4 and parses strict support json', async () => {
  const calls = [];
  const brain = new SupportBrain({
    provider: 'openrouter',
    openRouter: {
      apiKey: 'or-key',
      chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'upstage/solar-pro4',
      referer: 'https://soporte.mindblisspower.com',
      appTitle: 'Mindbliss Chatwoot Support Agent',
      timeoutMs: 90000,
      maxTokens: 700,
      temperature: 0.2,
      maxAnswerChars: 1800
    }
  }, {
    fetchJson: async (url, options) => {
      calls.push({ url, options });
      return {
        choices: [{
          message: {
            content: '{"answer":"Validaremos el OTP y el telefono antes de cerrar el caso.","escalate":false,"sources":[{"title":"KB OTP","score":0.91}]}'
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 }
      };
    }
  });

  const result = await brain.ask('No llega el codigo OTP', 'cliente@example.com');
  const request = calls[0];

  assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.timeoutMs, 90000);
  assert.equal(request.options.headers.Authorization, 'Bearer or-key');
  assert.equal(request.options.headers['HTTP-Referer'], 'https://soporte.mindblisspower.com');
  assert.equal(request.options.headers['X-OpenRouter-Title'], 'Mindbliss Chatwoot Support Agent');
  assert.equal(request.options.body.model, 'upstage/solar-pro4');
  assert.equal(request.options.body.messages[0].role, 'system');
  assert.equal(request.options.body.messages[1].role, 'user');
  assert.equal(request.options.body.messages[1].content, 'No llega el codigo OTP');
  assert.notEqual(request.options.body.user, 'cliente@example.com');
  assert.equal(request.options.body.user, pseudonymousUser('cliente@example.com'));
  assert.match(request.options.body.user, /^chatwoot:[a-f0-9]{32}$/);

  assert.equal(result.answer, 'Validaremos el OTP y el telefono antes de cerrar el caso.');
  assert.equal(result.escalate, false);
  assert.deepEqual(result.sources, [{ title: 'KB OTP', score: 0.91 }]);
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.model, 'upstage/solar-pro4');
  assert.equal(result.usage.total_tokens, 22);
});

test('escalates OpenRouter non-json responses instead of trusting free text', async () => {
  const brain = new SupportBrain({
    provider: 'openrouter',
    openRouter: {
      apiKey: 'or-key',
      chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'upstage/solar-pro4',
      timeoutMs: 90000,
      maxTokens: 700,
      temperature: 0.2,
      maxAnswerChars: 80
    }
  }, {
    fetchJson: async () => ({
      choices: [{ message: { content: 'No puedo confirmar el estado de cuenta sin validacion.' } }]
    })
  });

  const result = await brain.ask('Revise mi saldo', 'cliente@example.com');

  assert.equal(result.escalate, true);
  assert.equal(result.answer, 'No puedo confirmar el estado de cuenta sin validacion.');
  assert.deepEqual(result.sources, []);
});
