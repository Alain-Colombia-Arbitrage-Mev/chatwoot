# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Channel::WebWidget do
  context 'when
  web widget channel' do
    let!(:channel_widget) { create(:channel_widget) }

    it 'sets Mindbliss support pre chat options' do
      expect(channel_widget.pre_chat_form_enabled).to be true
      expect(channel_widget.pre_chat_form_options['pre_chat_message']).to eq Mindbliss::SupportPreChat::DEFAULT_MESSAGE
      expect(channel_widget.pre_chat_form_options['pre_chat_fields'].length).to eq 3
      expect(field('fullName')).to include('enabled' => true, 'required' => true, 'label' => 'Nombre completo')
      expect(field('phoneNumber')).to include('enabled' => true, 'required' => true, 'label' => 'Telefono o WhatsApp')
      expect(field('emailAddress')).to include('enabled' => false)
    end

    def field(name)
      channel_widget.pre_chat_form_options['pre_chat_fields'].find { |item| item['name'] == name }
    end
  end
end
