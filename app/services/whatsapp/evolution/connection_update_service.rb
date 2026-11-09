# Handles Evolution `connection.update`. On "open" we remember the linked number's
# JID (used to detect @mentions of the bot in groups); a non-recoverable "close"
# (logout / unlinked from the phone) prompts the admins to re-link the inbox.
class Whatsapp::Evolution::ConnectionUpdateService
  pattr_initialize [:channel!, :data!]

  def perform
    state = data[:state].to_s
    config = channel.provider_config.merge('connection_state' => state)
    config['owner_jid'] = data[:wuid] if state == 'open' && data[:wuid].present?
    # rubocop:disable Rails/SkipsModelValidations
    channel.update_column(:provider_config, config)
    # rubocop:enable Rails/SkipsModelValidations

    case state
    when 'open' then channel.reauthorized!
    when 'close' then channel.prompt_reauthorization!
    end
  end
end
