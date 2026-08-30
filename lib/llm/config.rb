require 'ruby_llm'

module Llm::Config
  DEFAULT_MODEL = 'gpt-4.1-mini'.freeze
  DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com'.freeze
  OPENROUTER_PROVIDER = 'openrouter'.freeze

  class << self
    def initialized?
      @initialized ||= false
    end

    def initialize!
      return if @initialized

      configure_ruby_llm
      @initialized = true
    end

    def reset!
      @initialized = false
    end

    def with_api_key(api_key, api_base: nil, provider: nil)
      initialize!
      normalized_api_base = api_base.present? ? api_base_for(api_base) : nil

      context = RubyLLM.context do |config|
        config.openai_api_key = api_key
        config.openai_api_base = normalized_api_base if normalized_api_base.present?
        configure_openrouter_provider(config, api_key: api_key, api_base: normalized_api_base, provider: provider)
      end

      yield context
    end

    def api_base_for(endpoint = openai_endpoint)
      endpoint = endpoint.to_s.strip.presence || DEFAULT_OPENAI_ENDPOINT
      endpoint = endpoint.chomp('/')
      return endpoint if endpoint.end_with?('/v1')

      "#{endpoint}/v1"
    end

    def system_api_key
      env_value('CAPTAIN_OPEN_AI_API_KEY') || installation_value('CAPTAIN_OPEN_AI_API_KEY')
    end

    def openrouter_api_key
      env_value('OPENROUTER_API_KEY') ||
        env_value('CAPTAIN_OPENROUTER_API_KEY') ||
        installation_value('CAPTAIN_OPENROUTER_API_KEY')
    end

    def provider_api_key(provider)
      return openrouter_api_key if provider.to_s == OPENROUTER_PROVIDER

      system_api_key
    end

    private

    def configure_ruby_llm
      RubyLLM.configure do |config|
        config.openai_api_key = system_api_key if system_api_key.present?
        config.openai_api_base = api_base_for(openai_endpoint) if openai_endpoint.present?
        config.openrouter_api_key = openrouter_api_key if openrouter_api_key.present?
        config.openrouter_api_base = openrouter_api_base if openrouter_api_base.present?
        config.model_registry_file = Rails.root.join('config/llm_models.json').to_s
        config.logger = Rails.logger
      end
    end

    def openai_endpoint
      env_value('CAPTAIN_OPEN_AI_ENDPOINT') || installation_value('CAPTAIN_OPEN_AI_ENDPOINT')
    end

    def configure_openrouter_provider(config, api_key:, api_base:, provider:)
      key = provider.to_s == OPENROUTER_PROVIDER ? openrouter_api_key.presence || api_key : openrouter_api_key
      return if key.blank?

      config.openrouter_api_key = key
      openrouter_base = openrouter_api_base(api_base)
      config.openrouter_api_base = openrouter_base if openrouter_base.present?
    end

    def openrouter_api_base(endpoint = openai_endpoint)
      normalized_api_base = api_base_for(endpoint)
      normalized_api_base if normalized_api_base.include?('openrouter.ai/')
    end

    def installation_value(name)
      InstallationConfig.find_by(name: name)&.value
    end

    def env_value(name)
      ENV[name].presence
    end
  end
end
