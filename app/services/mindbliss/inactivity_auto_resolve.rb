# frozen_string_literal: true

module Mindbliss::InactivityAutoResolve
  AUTO_RESOLVE_AFTER_MINUTES = 10
  AUTO_RESOLVE_LABEL = 'cerrado-por-inactividad'
  AUTO_RESOLVE_LABEL_COLOR = '#0ea5e9'
  AUTO_RESOLVE_MESSAGE = [
    'Cerramos este chat por inactividad de 10 minutos.',
    'Si aun necesitas ayuda, escribenos de nuevo por este canal y retomaremos tu caso.'
  ].join(' ')

  module_function

  def provision_all!
    Account.find_each { |account| provision_account!(account) }
  end

  def provision_account!(account)
    account.enable_features('auto_resolve_conversations')
    ensure_label!(account)
    account.update!(
      auto_resolve_after: AUTO_RESOLVE_AFTER_MINUTES,
      auto_resolve_message: AUTO_RESOLVE_MESSAGE,
      auto_resolve_ignore_waiting: false,
      auto_resolve_label: AUTO_RESOLVE_LABEL
    )
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
end
