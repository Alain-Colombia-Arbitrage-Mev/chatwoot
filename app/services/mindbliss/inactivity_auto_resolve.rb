# frozen_string_literal: true

module Mindbliss::InactivityAutoResolve
  AUTO_RESOLVE_AFTER_MINUTES = 10
  AUTO_RESOLVE_LABEL = 'cerrado-por-inactividad'
  AUTO_RESOLVE_LABEL_COLOR = '#0ea5e9'
  CAPTAIN_FEATURES = %w[
    captain_integration
    captain_integration_v2
    captain_tasks
    custom_tools
  ].freeze
  AUTO_RESOLVE_MESSAGE = [
    'Cerramos este chat por inactividad de 10 minutos.',
    'Si aun necesitas ayuda, escribenos de nuevo por este canal y retomaremos tu caso.'
  ].join(' ')

  module_function

  def provision_all!
    Account.find_each { |account| provision_account!(account) }
  end

  def provision_account!(account)
    account.enable_features('auto_resolve_conversations', *CAPTAIN_FEATURES)
    ensure_label!(account)
    account.update!(
      auto_resolve_after: nil,
      auto_resolve_message: nil,
      auto_resolve_ignore_waiting: true,
      auto_resolve_label: nil,
      captain_auto_resolve_mode: 'evaluated'
    )
    provision_captain_assistants!(account)
    account
  end

  def ensure_label!(account)
    label = account.labels.find_or_initialize_by(title: AUTO_RESOLVE_LABEL)
    label.color = AUTO_RESOLVE_LABEL_COLOR
    label.description = 'Conversaciones cerradas automaticamente tras 10 minutos de inactividad.'
    label.show_on_sidebar = true
    label.save! if label.new_record? || label.changed?
    label
  end

  def provision_captain_assistants!(account)
    return unless defined?(Captain::Assistant)

    Captain::Assistant.where(account_id: account.id).find_each do |assistant|
      assistant.update!(
        config: (assistant.config || {}).merge(
          'auto_resolve_mode' => 'evaluated',
          'auto_resolve_after' => AUTO_RESOLVE_AFTER_MINUTES,
          'send_inactivity_resolution_message' => true,
          'resolution_message' => AUTO_RESOLVE_MESSAGE
        )
      )
    end
  end
end
