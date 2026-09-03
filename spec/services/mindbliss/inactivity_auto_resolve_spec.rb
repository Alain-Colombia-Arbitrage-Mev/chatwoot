# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Mindbliss::InactivityAutoResolve do
  describe '.provision_account!' do
    let(:account) { create(:account) }

    it 'enables support and captain features for the account' do
      described_class.provision_account!(account)

      expect(account.reload).to be_feature_auto_resolve_conversations
      expect(account).to be_feature_captain_integration
      expect(account).to be_feature_captain_integration_v2
      expect(account).to be_feature_captain_tasks
    end

    it 'uses evaluated captain mode instead of native timed auto-resolve' do
      described_class.provision_account!(account)

      account.reload
      expect(account.auto_resolve_after).to be_nil
      expect(account.auto_resolve_ignore_waiting).to be(true)
      expect(account.auto_resolve_label).to be_nil
      expect(account.auto_resolve_message).to be_nil
      expect(account.captain_auto_resolve_mode).to eq('evaluated')
    end

    it 'creates the sidebar label used by auto resolved conversations' do
      described_class.provision_account!(account)

      label = account.labels.find_by!(title: 'cerrado-por-inactividad')
      expect(label.color).to eq('#0ea5e9')
      expect(label.show_on_sidebar).to be(true)
    end

    it 'updates existing configuration without duplicating the label' do
      account.labels.create!(title: 'cerrado-por-inactividad', color: '#111111', show_on_sidebar: false)
      account.update!(auto_resolve_after: 120, auto_resolve_ignore_waiting: false)

      expect { described_class.provision_account!(account) }.not_to change(account.labels, :count)
      expect(account.reload.auto_resolve_after).to be_nil
      expect(account.auto_resolve_ignore_waiting).to be(true)
      expect(account.labels.find_by!(title: 'cerrado-por-inactividad').show_on_sidebar).to be(true)
    end

    it 'configures existing captain assistants to evaluate inactive conversations after ten minutes' do
      captain_assistant_class = Class.new do
        def self.where(account_id:); end

        def config; end
        def update!(config:); end
      end
      stub_const('Captain::Assistant', captain_assistant_class)
      assistant = instance_double(Captain::Assistant, config: { 'auto_resolve_mode' => 'disabled', 'product_name' => 'Mindbliss' })
      relation = instance_double(ActiveRecord::Relation)

      allow(Captain::Assistant).to receive(:where).with(account_id: account.id).and_return(relation)
      allow(relation).to receive(:find_each).and_yield(assistant)

      expect(assistant).to receive(:update!).with(
        config: include(
          'auto_resolve_mode' => 'evaluated',
          'auto_resolve_after' => 10,
          'send_inactivity_resolution_message' => true,
          'resolution_message' => a_string_including('inactividad de 10 minutos'),
          'product_name' => 'Mindbliss'
        )
      )

      described_class.provision_account!(account)
    end
  end
end
