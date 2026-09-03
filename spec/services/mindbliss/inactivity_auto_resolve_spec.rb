# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Mindbliss::InactivityAutoResolve do
  describe '.provision_account!' do
    let(:account) { create(:account) }

    it 'enables ten minute inactivity resolution for the account' do
      described_class.provision_account!(account)

      expect(account.reload).to be_feature_auto_resolve_conversations
      expect(account.auto_resolve_after).to eq(10)
      expect(account.auto_resolve_ignore_waiting).to be(false)
      expect(account.auto_resolve_label).to eq('cerrado-por-inactividad')
      expect(account.auto_resolve_message).to include('inactividad de 10 minutos')
    end

    it 'creates the sidebar label used by auto resolved conversations' do
      described_class.provision_account!(account)

      label = account.labels.find_by!(title: 'cerrado-por-inactividad')
      expect(label.color).to eq('#0ea5e9')
      expect(label.show_on_sidebar).to be(true)
    end

    it 'updates existing configuration without duplicating the label' do
      account.labels.create!(title: 'cerrado-por-inactividad', color: '#111111', show_on_sidebar: false)
      account.update!(auto_resolve_after: 120, auto_resolve_ignore_waiting: true)

      expect { described_class.provision_account!(account) }.not_to change(account.labels, :count)
      expect(account.reload.auto_resolve_after).to eq(10)
      expect(account.auto_resolve_ignore_waiting).to be(false)
      expect(account.labels.find_by!(title: 'cerrado-por-inactividad').show_on_sidebar).to be(true)
    end
  end
end
