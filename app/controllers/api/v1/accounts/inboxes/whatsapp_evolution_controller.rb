# Linking flow for WhatsApp Web (Evolution API) inboxes: shows the connection
# state and returns a QR code or a pairing code to link the phone.
class Api::V1::Accounts::Inboxes::WhatsappEvolutionController < Api::V1::Accounts::BaseController
  before_action :fetch_inbox

  def show
    render json: { state: client.connection_state, owner_jid: channel.provider_config['owner_jid'] }
  rescue Whatsapp::Evolution::ApiClient::Error => e
    render json: { error: e.message }, status: :bad_gateway
  end

  # Pass `number` (digits, with country code) to get an 8-character pairing code instead of scanning a QR.
  def connect
    channel.provider_service.setup_webhook
    response = client.connect(number: params[:number].to_s.gsub(/\D/, ''))
    state = response.dig('instance', 'state')
    render json: { state: state || 'connecting', pairing_code: response['pairingCode'], qr_code: response['base64'] }
  rescue Whatsapp::Evolution::ApiClient::Error => e
    render json: { error: e.message }, status: :bad_gateway
  end

  private

  def fetch_inbox
    @inbox = Current.account.inboxes.find(params[:inbox_id])
    authorize @inbox, :update?
    head :unprocessable_entity unless @inbox.channel.is_a?(Channel::Whatsapp) && @inbox.channel.evolution?
  end

  def channel
    @inbox.channel
  end

  def client
    channel.provider_service.client
  end
end
