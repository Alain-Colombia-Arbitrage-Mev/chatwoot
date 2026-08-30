require 'rails_helper'

RSpec.describe Integrations::LlmBaseService do
  let(:account) { create(:account) }
  let(:inbox) { create(:inbox, account: account) }
  let(:conversation) { create(:conversation, account: account, inbox: inbox) }
  let(:hook) { create(:integrations_hook, :openai, account: account, settings: { 'api_key' => 'hook-key' }) }
  let(:event) { { 'name' => 'summarize', 'data' => { 'conversation_display_id' => conversation.display_id } } }
  let(:service) { described_class.new(hook: hook, event: event) }
  let(:error) { StandardError.new('API Error') }
  let(:body) { { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }] }.to_json }

  before do
    InstallationConfig.where(name: %w[CAPTAIN_OPEN_AI_API_KEY CAPTAIN_OPENROUTER_API_KEY CAPTAIN_OPEN_AI_ENDPOINT]).destroy_all
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('CAPTAIN_OPEN_AI_API_KEY').and_return(nil)
    allow(ENV).to receive(:[]).with('CAPTAIN_OPEN_AI_ENDPOINT').and_return(nil)
    allow(ENV).to receive(:[]).with('CAPTAIN_OPENROUTER_API_KEY').and_return(nil)
    allow(ENV).to receive(:[]).with('OPENROUTER_API_KEY').and_return(nil)
    allow(Integrations::Openai::KeyValidator).to receive(:valid?).and_return(true)
  end

  describe '#make_api_call' do
    before do
      allow(service).to receive(:instrument_llm_call).and_yield
      allow(Llm::Config).to receive(:with_api_key).and_raise(error)
    end

    it 'does not track exceptions for hook key failures' do
      expect(ChatwootExceptionTracker).not_to receive(:new)

      result = service.send(:make_api_call, body)

      expect(result[:error]).to eq('API Error')
      expect(result[:request_messages]).to eq([{ 'role' => 'user', 'content' => 'Hello' }])
    end

    it 'uses the OpenRouter key for OpenRouter models instead of the hook key' do
      create(:installation_config, name: 'CAPTAIN_OPENROUTER_API_KEY', value: 'openrouter-key')

      openrouter_body = { model: 'upstage/solar-pro4', messages: [{ role: 'user', content: 'Hello' }] }.to_json
      mock_context = instance_double(RubyLLM::Context)
      mock_chat = instance_double(RubyLLM::Chat)
      mock_response = instance_double(RubyLLM::Message, content: 'Draft reply', input_tokens: 3, output_tokens: 4)

      expect(Llm::Config).to receive(:with_api_key)
        .with('openrouter-key', api_base: anything, provider: 'openrouter')
        .and_yield(mock_context)
      expect(mock_context).to receive(:chat).with(model: 'upstage/solar-pro4').and_return(mock_chat)
      expect(mock_chat).to receive(:ask).with('Hello').and_return(mock_response)

      result = service.send(:make_api_call, openrouter_body)

      expect(result[:message]).to eq('Draft reply')
      expect(result[:usage]['total_tokens']).to eq(7)
    end

    it 'requires an OpenRouter key for OpenRouter models' do
      openrouter_body = { model: 'upstage/solar-pro4', messages: [{ role: 'user', content: 'Hello' }] }.to_json

      expect(Llm::Config).not_to receive(:with_api_key)

      result = service.send(:make_api_call, openrouter_body)

      expect(result[:error]).to eq(I18n.t('captain.api_key_missing'))
      expect(result[:request_messages]).to eq([{ 'role' => 'user', 'content' => 'Hello' }])
    end
  end
end
