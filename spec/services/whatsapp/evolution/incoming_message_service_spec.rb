require 'rails_helper'

describe Whatsapp::Evolution::IncomingMessageService do
  let(:api_url) { 'https://evo.example.com' }
  let(:channel) do
    stub_request(:get, "#{api_url}/instance/connectionState/support").to_return(
      status: 200, body: { instance: { instanceName: 'support', state: 'open' } }.to_json, headers: { 'Content-Type' => 'application/json' }
    )
    stub_request(:post, "#{api_url}/webhook/set/support").to_return(status: 201, body: '{}')
    create(:channel_whatsapp, provider: 'evolution', sync_templates: false, validate_provider_config: false,
                              provider_config: { 'api_url' => api_url, 'api_key' => 'key', 'instance_name' => 'support',
                                                 'owner_jid' => '573009999999@s.whatsapp.net' })
  end
  let(:inbox) { channel.inbox }

  def payload(key:, message: { conversation: 'hola' }, push_name: 'Ana', context_info: nil)
    { key: key, pushName: push_name, message: message, messageType: message.keys.first.to_s, contextInfo: context_info }
      .compact.with_indifferent_access
  end

  it 'creates a 1:1 conversation keyed by phone number' do
    described_class.new(inbox: inbox, data: payload(key: { remoteJid: '573001112222@s.whatsapp.net', fromMe: false, id: 'M1' })).perform

    contact_inbox = inbox.contact_inboxes.find_by!(source_id: '573001112222')
    expect(contact_inbox.contact).to have_attributes(name: 'Ana', phone_number: '+573001112222')
    message = inbox.messages.last
    expect(message).to have_attributes(content: 'hola', message_type: 'incoming', source_id: 'M1', sender: contact_inbox.contact)
    expect(message.conversation.group_chat?).to be(false)
  end

  context 'with a group message' do
    let(:group_jid) { '120363000000000001@g.us' }

    before do
      stub_request(:get, "#{api_url}/group/findGroupInfos/support").with(query: { groupJid: group_jid }).to_return(
        status: 200, headers: { 'Content-Type' => 'application/json' },
        body: { id: group_jid, subject: 'Clientes VIP', linkedParent: '120363000000000099@g.us', participants: [] }.to_json
      )
      stub_request(:get, "#{api_url}/group/findGroupInfos/support").with(query: { groupJid: '120363000000000099@g.us' }).to_return(
        status: 200, headers: { 'Content-Type' => 'application/json' }, body: { id: '120363000000000099@g.us', subject: 'Comunidad' }.to_json
      )
    end

    it 'creates one group conversation with the participant as sender' do
      data = payload(key: { remoteJid: group_jid, fromMe: false, id: 'G1', participant: '123@lid', participantAlt: '573004445555@s.whatsapp.net' })
      described_class.new(inbox: inbox, data: data).perform

      conversation = inbox.conversations.last
      expect(conversation.group_chat?).to be(true)
      expect(conversation.contact.name).to eq('Clientes VIP')
      expect(conversation.additional_attributes).to include('group_subject' => 'Clientes VIP', 'community_subject' => 'Comunidad')
      expect(inbox.messages.last.sender).to have_attributes(name: 'Ana', phone_number: '+573004445555')
      expect(inbox.messages.last.content_attributes['bot_mentioned']).to be_nil
    end

    it 'flags messages that mention the linked number' do
      data = payload(key: { remoteJid: group_jid, fromMe: false, id: 'G2', participant: '573004445555@s.whatsapp.net' },
                     context_info: { mentionedJid: ['573009999999@s.whatsapp.net'] })
      described_class.new(inbox: inbox, data: data).perform

      expect(inbox.messages.last.content_attributes['bot_mentioned']).to be(true)
    end
  end

  it 'stores messages typed on the linked phone as outgoing without re-sending them' do
    described_class.new(inbox: inbox, data: payload(key: { remoteJid: '573001112222@s.whatsapp.net', fromMe: true, id: 'M2' })).perform

    expect(inbox.messages.last).to have_attributes(message_type: 'outgoing', status: 'delivered', sender: nil)
  end

  it 'ignores status broadcasts and duplicate deliveries' do
    described_class.new(inbox: inbox, data: payload(key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' })).perform
    2.times { described_class.new(inbox: inbox, data: payload(key: { remoteJid: '573001112222@s.whatsapp.net', fromMe: false, id: 'M3' })).perform }

    expect(inbox.messages.where(source_id: %w[S1 M3]).count).to eq(1)
  end
end
