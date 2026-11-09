# WhatsApp Web provider backed by a self-hosted Evolution API (Baileys) instance.
#
# provider_config:
#   api_url          - Evolution base URL, e.g. https://wa.example.com
#   api_key          - global Evolution key (needed to create the instance) or the instance token
#   instance_name    - Evolution instance linked to this inbox
#   typing_delay_ms  - optional; Evolution shows "typing…" for this long before each text (default 1200)
#   webhook_verify_token, owner_jid, connection_state - managed by Chatwoot
#
# Unlike Meta's Cloud API there are no templates and no 24h window, and the
# recipient can be a phone number or a group JID (…@g.us).
class Whatsapp::Providers::EvolutionService < Whatsapp::Providers::BaseService
  DEFAULT_TYPING_DELAY_MS = 1200
  AUDIO_TYPES = %w[audio].freeze
  MEDIA_TYPES = %w[image video].freeze

  def send_message(recipient, message)
    attachment = message.attachments.first
    response = if attachment
                 send_attachment(recipient, message, attachment)
               else
                 client.send_text(number: recipient, text: text_content(message), quoted_id: reply_to(message), delay: typing_delay)
               end
    response.dig('key', 'id')
  rescue Whatsapp::Evolution::ApiClient::Error => e
    Rails.logger.error("[WHATSAPP EVOLUTION] send failed inbox=#{whatsapp_channel.inbox&.id}: #{e.message}")
    message.update!(status: :failed, external_error: e.message)
    nil
  end

  def send_template(_recipient, _template_info, message)
    message.update!(status: :failed, external_error: I18n.t('errors.whatsapp.evolution.templates_not_supported'))
    nil
  end

  def sync_templates
    # rubocop:disable Rails/SkipsModelValidations
    whatsapp_channel.update_columns(message_templates: [], message_templates_last_updated: Time.now.utc)
    # rubocop:enable Rails/SkipsModelValidations
  end

  # Creates the Evolution instance on first save when it doesn't exist yet,
  # so admins only need the Evolution URL + global key + an instance name.
  def validate_provider_config?
    return false if whatsapp_channel.provider_config.values_at('api_url', 'api_key', 'instance_name').any?(&:blank?)

    client.connection_state
    true
  rescue Whatsapp::Evolution::ApiClient::Error => e
    return create_instance if e.status == 404

    Rails.logger.warn("[WHATSAPP EVOLUTION] invalid config: #{e.message}")
    false
  end

  def setup_webhook
    client.set_webhook(url: webhook_url)
  end

  def webhook_url
    "#{ENV.fetch('FRONTEND_URL', nil)}/webhooks/whatsapp_evolution/#{whatsapp_channel.provider_config['webhook_verify_token']}"
  end

  def api_headers
    {}
  end

  def client
    @client ||= Whatsapp::Evolution::ApiClient.new(
      api_url: whatsapp_channel.provider_config['api_url'],
      api_key: whatsapp_channel.provider_config['api_key'],
      instance_name: whatsapp_channel.provider_config['instance_name']
    )
  end

  private

  def create_instance
    client.create_instance(number: whatsapp_channel.phone_number.to_s.delete('+'))
    true
  rescue Whatsapp::Evolution::ApiClient::Error => e
    Rails.logger.warn("[WHATSAPP EVOLUTION] instance creation failed: #{e.message}")
    false
  end

  def send_attachment(recipient, message, attachment)
    if AUDIO_TYPES.include?(attachment.file_type)
      return client.send_audio(number: recipient, audio: attachment.download_url, quoted_id: reply_to(message))
    end

    client.send_media(
      number: recipient,
      quoted_id: reply_to(message),
      media: {
        mediatype: MEDIA_TYPES.include?(attachment.file_type) ? attachment.file_type : 'document',
        media: attachment.download_url,
        mimetype: attachment.file.content_type,
        fileName: attachment.file.filename.to_s,
        caption: message.outgoing_content
      }
    )
  end

  # Baileys interactive buttons are unreliable on WhatsApp Web, so options are sent as a numbered list.
  def text_content(message)
    return message.outgoing_content unless message.content_type == 'input_select'

    options = message.content_attributes['items'].each_with_index.map { |item, index| "#{index + 1}. #{item['title']}" }
    [message.outgoing_content, options.join("\n")].compact_blank.join("\n\n")
  end

  def reply_to(message)
    message.content_attributes[:in_reply_to_external_id]
  end

  def typing_delay
    (whatsapp_channel.provider_config['typing_delay_ms'].presence || DEFAULT_TYPING_DELAY_MS).to_i
  end
end
