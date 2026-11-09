class Webhooks::WhatsappEvolutionEventsJob < MutexApplicationJob
  queue_as :low
  retry_on LockAcquisitionError, wait: 2.seconds, attempts: 20

  def perform(channel_id, params)
    @channel = Channel::Whatsapp.find_by(id: channel_id)
    return if @channel.blank? || !@channel.account.active?

    params = params.with_indifferent_access
    process_event(params[:event], params[:data] || {})
  end

  private

  def process_event(event, data)
    inbox = @channel.inbox
    case event
    when 'messages.upsert'
      process_message(inbox, data)
    when 'messages.update'
      Whatsapp::Evolution::StatusUpdateService.new(inbox: inbox, data: data).perform
    when 'messages.delete'
      Whatsapp::Evolution::StatusUpdateService.new(inbox: inbox, data: data.merge(status: 'DELETED')).perform
    when 'connection.update'
      Whatsapp::Evolution::ConnectionUpdateService.new(channel: @channel, data: data).perform
    when 'groups.upsert', 'group-participants.update'
      Whatsapp::Evolution::GroupSyncService.new(inbox: inbox, group_jid: Array.wrap(data).first&.dig(:id)).perform
    end
  end

  # Serialize per chat so the first message creates the conversation and the rest append to it.
  def process_message(inbox, data)
    key = format(::Redis::Alfred::WHATSAPP_EVOLUTION_CHAT_MUTEX, inbox_id: inbox.id, chat_jid: data.dig(:key, :remoteJid))
    with_lock(key, 30.seconds) { Whatsapp::Evolution::IncomingMessageService.new(inbox: inbox, data: data).perform }
  end
end
