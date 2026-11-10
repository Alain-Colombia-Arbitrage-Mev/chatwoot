# frozen_string_literal: true

require 'agents'

Rails.application.config.after_initialize do
  api_key = Llm::Config.system_api_key
  openrouter_api_key = Llm::Config.openrouter_api_key
  model = InstallationConfig.find_by(name: 'CAPTAIN_OPEN_AI_MODEL')&.value.presence || LlmConstants::DEFAULT_MODEL
  api_endpoint = InstallationConfig.find_by(name: 'CAPTAIN_OPEN_AI_ENDPOINT')&.value

  Agents.configure do |config|
    config.openai_api_key = api_key if api_key.present?
    config.openai_api_base = Llm::Config.api_base_for(api_endpoint) if api_key.present? && api_endpoint.present?
    config.openrouter_api_key = openrouter_api_key if openrouter_api_key.present?
    config.default_model = model
    config.openai_protocol = :chat_completions
    config.model_registry_file = Rails.root.join('config/llm_models.json').to_s
    config.debug = false
  end
rescue StandardError => e
  Rails.logger.error "Failed to configure AI Agents SDK: #{e.message}"
end
