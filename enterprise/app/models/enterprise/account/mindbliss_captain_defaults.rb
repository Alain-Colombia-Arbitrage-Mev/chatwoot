# Mindbliss self-hosted Enterprise runs the full Captain stack (V2, tasks, custom tools) on every new account.
module Enterprise::Account::MindblissCaptainDefaults
  FEATURES = %w[captain_integration captain_integration_v2 captain_tasks custom_tools].freeze

  private

  def enable_default_features
    super
    enable_features(*FEATURES) if ChatwootApp.self_hosted_enterprise?
  end
end
