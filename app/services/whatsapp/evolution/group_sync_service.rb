# Fetches (and caches) WhatsApp group / community metadata from Evolution and
# keeps the group contact + open conversation labelled with the current subject.
class Whatsapp::Evolution::GroupSyncService
  CACHE_TTL = 1.hour.to_i

  pattr_initialize [:inbox!, :group_jid!]

  # Called on groups.upsert / group-participants.update: refresh cache and names.
  def perform
    ::Redis::Alfred.delete(cache_key)
    contact_inbox = inbox.contact_inboxes.find_by(source_id: group_jid)
    return if contact_inbox.blank? || info['subject'].blank?

    contact_inbox.contact.update!(name: info['subject'])
    contact_inbox.conversations.where.not(status: :resolved).find_each do |conversation|
      conversation.update!(additional_attributes: conversation.additional_attributes.merge('group_subject' => info['subject']))
    end
  end

  def info
    @info ||= cached_info || fetch_info
  end

  private

  def cache_key
    format(::Redis::Alfred::WHATSAPP_EVOLUTION_GROUP_INFO, inbox_id: inbox.id, group_jid: group_jid)
  end

  def cached_info
    cached = ::Redis::Alfred.get(cache_key)
    JSON.parse(cached) if cached.present?
  end

  # Participants are dropped: large communities make the payload heavy and we only need metadata.
  def fetch_info
    info = inbox.channel.provider_service.client.group_info(group_jid).except('participants')
    ::Redis::Alfred.setex(cache_key, info.to_json, CACHE_TTL)
    info
  rescue Whatsapp::Evolution::ApiClient::Error => e
    Rails.logger.warn("[WHATSAPP EVOLUTION] group info failed group=#{group_jid}: #{e.message}")
    {}
  end
end
