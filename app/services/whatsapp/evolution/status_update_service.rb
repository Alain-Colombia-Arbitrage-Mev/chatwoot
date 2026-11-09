# Handles Evolution `messages.update` (delivery/read acks) and `messages.delete`.
# Payload: { keyId:, remoteJid:, fromMe:, status: SERVER_ACK|DELIVERY_ACK|READ|PLAYED|ERROR|DELETED }
class Whatsapp::Evolution::StatusUpdateService
  STATUS_MAP = {
    'SERVER_ACK' => 'sent',
    'DELIVERY_ACK' => 'delivered',
    'READ' => 'read',
    'PLAYED' => 'read',
    'ERROR' => 'failed'
  }.freeze

  pattr_initialize [:inbox!, :data!]

  def perform
    message = inbox.messages.find_by(source_id: data[:keyId] || data[:id] || data.dig(:key, :id))
    return if message.blank?
    return message.update!(content: I18n.t('conversations.messages.deleted'), deleted: true) if data[:status] == 'DELETED'

    status = STATUS_MAP[data[:status]]
    Messages::StatusUpdateService.new(message, status).perform if status.present? && message.outgoing?
  end
end
