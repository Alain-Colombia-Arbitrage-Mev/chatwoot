# Resolves the API credential for Captain LLM calls: the account's OpenAI hook, the installation OpenAI key,
# or the installation OpenRouter key for OpenRouter models. Services can override #llm_credential.
module Captain::LlmCredentials
  private

  def api_key_configured?
    llm_credential.present?
  end

  def api_key
    llm_credential&.dig(:api_key)
  end

  # OpenRouter models always use the installation's OpenRouter key; other models use the OpenAI-compatible credential.
  def provider_llm_credential(provider)
    return openrouter_llm_credential if provider.to_s == Llm::Config::OPENROUTER_PROVIDER

    llm_credential
  end

  def llm_credential
    @llm_credential ||= if use_account_openai_hook?
                          hook_llm_credential || system_llm_credential
                        else
                          system_llm_credential
                        end
  end

  def use_account_openai_hook?
    false
  end

  def hook_llm_credential
    key = openai_hook&.settings&.dig('api_key').presence
    { api_key: key, source: :hook } if key
  end

  def system_llm_credential
    { api_key: system_api_key, source: :system } if system_api_key.present?
  end

  def openrouter_llm_credential
    key = Llm::Config.provider_api_key(Llm::Config::OPENROUTER_PROVIDER)
    { api_key: key, source: :system } if key.present?
  end

  def openai_hook
    @openai_hook ||= account.hooks.find_by(app_id: 'openai', status: 'enabled')
  end

  def system_api_key
    @system_api_key ||= Llm::Config.system_api_key
  end
end
