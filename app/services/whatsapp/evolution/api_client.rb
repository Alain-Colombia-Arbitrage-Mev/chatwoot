# Thin HTTP client for Evolution API v2 (WhatsApp Web via Baileys).
#
# Shapes follow the Evolution API source (src/api/routes, src/api/dto), which
# differs from the published docs in places:
# - successful POSTs return 201
# - /webhook/set expects the body nested under "webhook"
# - /instance/fetchInstances returns a bare array of rows (name, ownerJid, token)
# Auth is the `apikey` header: either the global key or the instance token.
class Whatsapp::Evolution::ApiClient
  class Error < StandardError
    attr_reader :status, :body

    def initialize(message, status: nil, body: nil)
      super(message)
      @status = status
      @body = body
    end
  end

  DEFAULT_TIMEOUT = 30

  WEBHOOK_EVENTS = %w[
    MESSAGES_UPSERT
    MESSAGES_UPDATE
    MESSAGES_DELETE
    CONNECTION_UPDATE
    GROUPS_UPSERT
    GROUP_PARTICIPANTS_UPDATE
  ].freeze

  attr_reader :api_url, :instance_name

  def initialize(api_url:, api_key:, instance_name:)
    @api_url = api_url.to_s.strip.chomp('/')
    @api_key = api_key.to_s.strip
    @instance_name = instance_name.to_s.strip
  end

  # --- Instance -----------------------------------------------------------

  def connection_state
    get("/instance/connectionState/#{instance_path}").dig('instance', 'state')
  end

  def fetch_instance
    Array(get('/instance/fetchInstances', query: { instanceName: instance_name })).first
  end

  def create_instance(number: nil)
    post('/instance/create', {
      instanceName: instance_name,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      number: number.presence
    }.compact)
  end

  # Returns { 'pairingCode', 'code', 'base64', 'count' } while connecting,
  # or { 'instance' => { 'state' => 'open' } } once linked.
  def connect(number: nil)
    get("/instance/connect/#{instance_path}", query: { number: number.presence }.compact)
  end

  def set_webhook(url:, headers: {})
    post("/webhook/set/#{instance_path}", {
           webhook: {
             enabled: true,
             url: url,
             headers: headers,
             byEvents: false,
             base64: true,
             events: WEBHOOK_EVENTS
           }
         })
  end

  # --- Messages -----------------------------------------------------------

  def send_text(number:, text:, quoted_id: nil, delay: nil)
    post("/message/sendText/#{instance_path}", { number: number, text: text, delay: delay, quoted: quoted_payload(quoted_id) }.compact)
  end

  # media: { mediatype: 'image' | 'video' | 'document', media: url, mimetype:, fileName:, caption: }
  def send_media(number:, media:, quoted_id: nil)
    post("/message/sendMedia/#{instance_path}", { number: number, **media, quoted: quoted_payload(quoted_id) }.compact_blank)
  end

  def send_audio(number:, audio:, quoted_id: nil)
    post("/message/sendWhatsAppAudio/#{instance_path}", { number: number, audio: audio, quoted: quoted_payload(quoted_id) }.compact)
  end

  # Returns { 'base64', 'mimetype', 'fileName', 'mediaType' }
  def media_base64(key)
    post("/chat/getBase64FromMediaMessage/#{instance_path}", { message: { key: key }, convertToMp4: false })
  end

  # --- Groups -----------------------------------------------------

  # Returns { 'id', 'subject', 'desc', 'size', 'pictureUrl', 'participants',
  #           'isCommunity', 'isCommunityAnnounce', 'linkedParent' }
  def group_info(group_jid)
    get("/group/findGroupInfos/#{instance_path}", query: { groupJid: group_jid })
  end

  private

  def instance_path
    ERB::Util.url_encode(instance_name)
  end

  def quoted_payload(quoted_id)
    return if quoted_id.blank?

    { key: { id: quoted_id } }
  end

  def headers
    { 'apikey' => @api_key, 'Content-Type' => 'application/json', 'Accept' => 'application/json' }
  end

  def get(path, query: {})
    handle(HTTParty.get("#{api_url}#{path}", headers: headers, query: query, timeout: DEFAULT_TIMEOUT))
  end

  def post(path, body)
    handle(HTTParty.post("#{api_url}#{path}", headers: headers, body: body.to_json, timeout: DEFAULT_TIMEOUT))
  end

  def handle(response)
    parsed = response.parsed_response
    raise Error.new(error_message(parsed, response), status: response.code, body: parsed) unless response.success?
    # /instance/connect reports failures as HTTP 200 with { error: true }
    raise Error.new(error_message(parsed, response), status: response.code, body: parsed) if parsed.is_a?(Hash) && parsed['error'] == true

    parsed
  rescue HTTParty::Error, Net::OpenTimeout, Net::ReadTimeout, SocketError, Errno::ECONNREFUSED => e
    raise Error, "Evolution API unreachable: #{e.message}"
  end

  def error_message(parsed, response)
    message = parsed.is_a?(Hash) ? (parsed.dig('response', 'message') || parsed['message'] || parsed['error']) : nil
    message = message.join(', ') if message.is_a?(Array)
    "Evolution API error (#{response.code}): #{message.presence || response.body.to_s.truncate(200)}"
  end
end
