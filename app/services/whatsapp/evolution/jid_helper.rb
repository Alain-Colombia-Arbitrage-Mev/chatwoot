# WhatsApp JIDs: "573001234567@s.whatsapp.net" (phone), "1203…@g.us" (group), "1234…@lid" (privacy id).
module Whatsapp::Evolution::JidHelper
  PHONE_JID_SUFFIX = '@s.whatsapp.net'.freeze

  def group_jid?(jid)
    jid.to_s.end_with?('@g.us')
  end

  # Phone JIDs become the bare number (same source_id format as the Cloud API inbox);
  # LIDs and groups keep the full JID because there is no phone to derive.
  def jid_to_source_id(jid)
    jid.to_s.end_with?(PHONE_JID_SUFFIX) ? jid.to_s.delete_suffix(PHONE_JID_SUFFIX).split(':').first : jid.to_s
  end

  def jid_to_phone(jid)
    return unless jid.to_s.end_with?(PHONE_JID_SUFFIX)

    "+#{jid_to_source_id(jid)}"
  end

  # Baileys may address a participant by LID and send the phone JID as the "Alt" field.
  def preferred_jid(jid, alt_jid)
    [jid, alt_jid].compact_blank.find { |candidate| candidate.to_s.end_with?(PHONE_JID_SUFFIX) } || jid.presence || alt_jid
  end
end
