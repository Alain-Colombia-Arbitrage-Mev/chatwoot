# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Mindbliss::SupportCannedResponses do
  describe '.provision_account!' do
    let(:account) { create(:account) }

    it 'creates Mindbliss support canned responses' do
      described_class.provision_account!(account)

      expect(account.canned_responses.pluck(:short_code)).to include(
        'mb_describir_problema',
        'mb_datos_soporte',
        'mb_recibido_pronto',
        'mb_revision_caso',
        'mb_falta_detalle'
      )
      expect(account.canned_responses.find_by(short_code: 'mb_recibido_pronto').content).to include(
        'equipo de soporte lo revisara pronto'
      )
    end

    it 'updates existing Mindbliss responses without duplicating them' do
      create(:canned_response, account: account, short_code: 'mb_recibido_pronto', content: 'Mensaje anterior')

      expect { described_class.provision_account!(account) }.to change(account.canned_responses, :count).by(4)
      expect(account.canned_responses.where(short_code: 'mb_recibido_pronto').count).to eq(1)
      expect(account.canned_responses.find_by(short_code: 'mb_recibido_pronto').content).to include(
        'Ya tenemos tu caso registrado'
      )
    end
  end
end
