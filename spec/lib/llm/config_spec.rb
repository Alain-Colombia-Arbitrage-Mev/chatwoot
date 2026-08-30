# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Llm::Config do
  before do
    InstallationConfig.where(name: %w[CAPTAIN_OPEN_AI_API_KEY CAPTAIN_OPEN_AI_ENDPOINT CAPTAIN_OPENROUTER_API_KEY]).destroy_all
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with('CAPTAIN_OPEN_AI_API_KEY').and_return(nil)
    allow(ENV).to receive(:[]).with('CAPTAIN_OPEN_AI_ENDPOINT').and_return(nil)
    allow(ENV).to receive(:[]).with('CAPTAIN_OPENROUTER_API_KEY').and_return(nil)
    allow(ENV).to receive(:[]).with('OPENROUTER_API_KEY').and_return(nil)
  end

  describe '.api_base_for' do
    it 'uses the OpenAI chat API base by default' do
      expect(described_class.api_base_for).to eq('https://api.openai.com/v1')
    end

    it 'does not duplicate v1 when the endpoint already includes it' do
      expect(described_class.api_base_for('https://openrouter.ai/api/v1')).to eq('https://openrouter.ai/api/v1')
    end

    it 'adds v1 to an OpenRouter API root endpoint' do
      expect(described_class.api_base_for('https://openrouter.ai/api')).to eq('https://openrouter.ai/api/v1')
    end
  end

  describe '.openrouter_api_key' do
    it 'prefers OPENROUTER_API_KEY from the environment' do
      create(:installation_config, name: 'CAPTAIN_OPENROUTER_API_KEY', value: 'config-key')
      allow(ENV).to receive(:[]).with('OPENROUTER_API_KEY').and_return('env-key')

      expect(described_class.openrouter_api_key).to eq('env-key')
    end

    it 'falls back to the OpenRouter installation config' do
      create(:installation_config, name: 'CAPTAIN_OPENROUTER_API_KEY', value: 'config-key')

      expect(described_class.openrouter_api_key).to eq('config-key')
    end
  end

  describe '.with_api_key' do
    it 'configures the native OpenRouter provider for OpenRouter models' do
      config = double('RubyLLM config')

      allow(described_class).to receive(:initialize!)
      allow(RubyLLM).to receive(:context).and_yield(config).and_return(:context)
      allow(config).to receive(:openai_api_key=)
      allow(config).to receive(:openai_api_base=)

      expect(config).to receive(:openrouter_api_key=).with('openrouter-key')
      expect(config).not_to receive(:openrouter_api_base=)

      described_class.with_api_key('openrouter-key', api_base: 'https://api.openai.com/v1', provider: 'openrouter') { |context| context }
    end

    it 'normalizes and passes an OpenRouter base URL when configured' do
      config = double('RubyLLM config')

      allow(described_class).to receive(:initialize!)
      allow(RubyLLM).to receive(:context).and_yield(config).and_return(:context)
      allow(config).to receive(:openai_api_key=)
      allow(config).to receive(:openai_api_base=)

      expect(config).to receive(:openrouter_api_key=).with('openrouter-key')
      expect(config).to receive(:openrouter_api_base=).with('https://openrouter.ai/api/v1')

      described_class.with_api_key('openrouter-key', api_base: 'https://openrouter.ai/api', provider: 'openrouter') { |context| context }
    end
  end
end
