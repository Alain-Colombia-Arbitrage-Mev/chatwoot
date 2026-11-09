# Handles Evolution `messages.upsert` events.
#
# 1:1 chats map to a contact per phone (or LID). Groups and community subgroups
# map to a single "group contact" (source_id = group JID) and one conversation per
# group; each message's sender is the participant's own contact, so agents see who
# said what. Messages typed on the linked phone (fromMe) are stored as outgoing.
class Whatsapp::Evolution::IncomingMessageService
  include Whatsapp::Evolution::JidHelper

  pattr_initialize [:inbox!, :data!]

  IGNORED_CHAT_SUFFIXES = %w[@broadcast @newsletter].freeze

  def perform
    return if ignored_chat? || unsupported_message?
    return unless Whatsapp::MessageDedupLock.new("evolution:#{inbox.id}:#{message_id}").acquire!
    return if inbox.messages.exists?(source_id: message_id)

    set_chat_contact
    set_conversation
    build_message
    attachment_builder.build_for(@message)
    @message.save!
  end

  private

  def key = data[:key] || {}
  def message_id = key[:id]
  def chat_jid = key[:remoteJid].to_s
  def from_me? = ActiveModel::Type::Boolean.new.cast(key[:fromMe])
  def payload = data[:message] || {}
  def message_type = data[:messageType].to_s
  # Typed body for the message type, e.g. payload[:imageMessage]; plain text (`conversation`) is a bare string.
  def typed_body = payload[message_type].is_a?(Hash) ? payload[message_type] : {}
  def context_info = data[:contextInfo] || typed_body[:contextInfo] || {}
  def group? = group_jid?(chat_jid)

  def ignored_chat?
    chat_jid.blank? || chat_jid == 'status@broadcast' || IGNORED_CHAT_SUFFIXES.any? { |suffix| chat_jid.end_with?(suffix) }
  end

  # Reactions, protocol messages (edits/revokes), polls updates etc. have no content to show.
  def unsupported_message?
    message_id.blank? || (text_content.blank? && !attachment_builder.attachable?)
  end

  def attachment_builder
    @attachment_builder ||= Whatsapp::Evolution::AttachmentBuilder.new(inbox: inbox, data: data)
  end

  def set_chat_contact
    @contact_inbox = ::ContactInboxWithContactBuilder.new(
      source_id: group? ? chat_jid : jid_to_source_id(chat_jid),
      inbox: inbox,
      contact_attributes: group? ? group_contact_attributes : individual_contact_attributes
    ).perform
    @contact = @contact_inbox.contact
  end

  def individual_contact_attributes
    phone = jid_to_phone(chat_jid)
    {
      name: (from_me? ? nil : data[:pushName].presence) || phone || chat_jid,
      phone_number: phone,
      additional_attributes: { whatsapp_jid: chat_jid }
    }
  end

  def group_contact_attributes
    {
      name: group_info['subject'].presence || chat_jid,
      avatar_url: group_info['pictureUrl'],
      additional_attributes: { whatsapp_group: true, whatsapp_jid: chat_jid, community_jid: group_info['linkedParent'] }.compact
    }
  end

  def group_info
    @group_info ||= Whatsapp::Evolution::GroupSyncService.new(inbox: inbox, group_jid: chat_jid).info
  end

  def set_conversation
    conversations = @contact_inbox.conversations
    existing = inbox.lock_to_single_conversation ? conversations.last : conversations.where.not(status: :resolved).last
    @conversation = existing || ::Conversation.create!(
      account_id: inbox.account_id,
      inbox_id: inbox.id,
      contact_id: @contact.id,
      contact_inbox_id: @contact_inbox.id,
      additional_attributes: group? ? group_conversation_attributes : { chat_type: 'individual' }
    )
  end

  def group_conversation_attributes
    {
      chat_type: 'group',
      group_jid: chat_jid,
      group_subject: group_info['subject'],
      community_jid: group_info['linkedParent'],
      community_subject: community_subject,
      community_announce: group_info['isCommunityAnnounce'] == true
    }.compact
  end

  def community_subject
    return if group_info['linkedParent'].blank?

    Whatsapp::Evolution::GroupSyncService.new(inbox: inbox, group_jid: group_info['linkedParent']).info['subject']
  end

  def build_message
    @message = @conversation.messages.build(
      content: text_content,
      account_id: inbox.account_id,
      inbox_id: inbox.id,
      message_type: from_me? ? :outgoing : :incoming,
      # delivered + source_id keep SendReplyJob from re-sending messages typed on the phone
      status: from_me? ? :delivered : :sent,
      sender: from_me? ? nil : message_sender,
      source_id: message_id,
      content_attributes: message_content_attributes
    )
  end

  # In groups the conversation contact is the group itself; the sender is the participant.
  def message_sender
    return @contact unless group?

    participant_jid = preferred_jid(key[:participant], key[:participantAlt])
    return @contact if participant_jid.blank?

    ::ContactInboxWithContactBuilder.new(
      source_id: jid_to_source_id(participant_jid),
      inbox: inbox,
      contact_attributes: {
        name: data[:pushName].presence || jid_to_phone(participant_jid) || participant_jid,
        phone_number: jid_to_phone(participant_jid),
        additional_attributes: { whatsapp_jid: participant_jid }
      }
    ).perform.contact
  end

  def message_content_attributes
    attrs = {}
    attrs[:external_echo] = true if from_me?
    if (quoted_id = context_info[:stanzaId]).present?
      attrs[:in_reply_to_external_id] = quoted_id
      attrs[:in_reply_to] = quoted_message&.id
    end
    attrs[:bot_mentioned] = true if group? && !from_me? && bot_mentioned?
    attrs.compact
  end

  def quoted_message
    @quoted_message ||= inbox.messages.find_by(source_id: context_info[:stanzaId])
  end

  # The AI agent only answers in groups when it is @mentioned or someone replies to one of its messages.
  def bot_mentioned?
    owner_jid = inbox.channel.provider_config['owner_jid']
    mentioned = Array(context_info[:mentionedJid])
    return true if owner_jid.present? && (mentioned.include?(owner_jid) || context_info[:participant] == owner_jid)

    quoted_message&.outgoing? || false
  end

  def text_content
    @text_content ||= payload[:conversation].presence ||
                      payload.dig(:extendedTextMessage, :text).presence ||
                      typed_body[:caption].presence ||
                      payload.dig(:pollCreationMessage, :name).presence ||
                      payload.dig(:pollCreationMessageV3, :name).presence ||
                      contact_card_content
  end

  def contact_card_content
    card = payload[:contactMessage]
    return if card.blank?

    [card[:displayName], card[:vcard].to_s[/TEL[^:]*:([^\n]+)/, 1]&.strip].compact_blank.join(' - ')
  end
end
