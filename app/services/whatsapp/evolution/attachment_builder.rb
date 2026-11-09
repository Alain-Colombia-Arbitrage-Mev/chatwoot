# Builds media and location attachments for an Evolution `messages.upsert` payload.
class Whatsapp::Evolution::AttachmentBuilder
  include ::FileTypeHelper

  pattr_initialize [:inbox!, :data!]

  MEDIA_TYPES = {
    'imageMessage' => :image,
    'stickerMessage' => :image,
    'videoMessage' => :video,
    'ptvMessage' => :video,
    'audioMessage' => :audio,
    'documentMessage' => :file
  }.freeze

  def attachable?
    MEDIA_TYPES.key?(message_type) || location.present?
  end

  def build_for(message)
    attach_media(message)
    attach_location(message)
  end

  private

  def payload = data[:message] || {}
  def message_type = data[:messageType].to_s
  def media_info = payload[message_type] || {}
  def location = payload[:locationMessage] || payload[:liveLocationMessage]

  def attach_media(message)
    return unless MEDIA_TYPES.key?(message_type)

    media = media_payload
    return if media['base64'].blank?

    content_type = media['mimetype'].presence || media_info[:mimetype]
    message.attachments.new(
      account_id: inbox.account_id,
      file_type: media_file_type(content_type),
      file: {
        io: StringIO.new(Base64.decode64(media['base64'])),
        filename: media['fileName'].presence || media_info[:fileName].presence || default_filename(content_type),
        content_type: content_type
      }
    )
  end

  def media_file_type(content_type)
    file_type = MEDIA_TYPES[message_type]
    file_type == :file ? file_type(content_type) : file_type
  end

  def default_filename(content_type)
    extension = Rack::Mime::MIME_TYPES.invert[content_type.to_s.split(';').first] || '.bin'
    "#{data.dig(:key, :id)}#{extension}"
  end

  # Webhooks are registered with base64 enabled; fall back to fetching it for large files Evolution skipped.
  def media_payload
    return { 'base64' => payload[:base64], 'mimetype' => media_info[:mimetype] } if payload[:base64].present?

    inbox.channel.provider_service.client.media_base64(data[:key].to_h)
  rescue Whatsapp::Evolution::ApiClient::Error => e
    Rails.logger.warn("[WHATSAPP EVOLUTION] media download failed message=#{data.dig(:key, :id)}: #{e.message}")
    {}
  end

  def attach_location(message)
    return if location.blank?

    message.attachments.new(
      account_id: inbox.account_id,
      file_type: :location,
      coordinates_lat: location[:degreesLatitude],
      coordinates_long: location[:degreesLongitude],
      fallback_title: location[:name].presence || location[:address].to_s
    )
  end
end
