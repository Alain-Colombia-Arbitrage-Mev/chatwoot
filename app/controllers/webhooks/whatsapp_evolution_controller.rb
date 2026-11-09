# Receives Evolution API (WhatsApp Web / Baileys) webhooks. Each inbox gets its
# own unguessable URL token (provider_config['webhook_verify_token']), which is
# how the channel is identified and authenticated.
class Webhooks::WhatsappEvolutionController < ActionController::API
  def process_payload
    channel = Channel::Whatsapp.where(provider: 'evolution')
                               .find_by("provider_config->>'webhook_verify_token' = ?", params[:webhook_token])
    return head :not_found if channel.blank?

    Webhooks::WhatsappEvolutionEventsJob.perform_later(channel.id, params.to_unsafe_hash.except(:controller, :action, :webhook_token))
    head :ok
  end
end
