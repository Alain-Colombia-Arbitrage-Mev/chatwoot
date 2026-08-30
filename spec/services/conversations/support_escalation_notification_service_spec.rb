# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Conversations::SupportEscalationNotificationService do
  subject(:perform) { described_class.new(conversation: conversation).perform }

  let(:account) { create(:account) }
  let(:assignee) { create(:user, account: account) }
  let(:team_agent) { create(:user, account: account) }
  let(:unconfirmed_agent) { create(:user, account: account) }
  let(:team) { create(:team, account: account) }
  let(:conversation) { create(:conversation, account: account, assignee: assignee, team: team) }
  let(:mailer) { double }
  let(:message_delivery) { double }

  before do
    create(:team_member, team: team, user: assignee)
    create(:team_member, team: team, user: team_agent)
    create(:team_member, team: team, user: unconfirmed_agent)
    unconfirmed_agent.update!(confirmed_at: nil)

    allow(account).to receive(:within_email_rate_limit?).and_return(true)
    allow(account).to receive(:increment_email_sent_count)
    allow(AgentNotifications::ConversationNotificationsMailer)
      .to receive(:with).with(account: account).and_return(mailer)
    allow(mailer).to receive(:conversation_escalation).and_return(message_delivery)
    allow(message_delivery).to receive(:deliver_later)
  end

  it 'emails the assigned agent and confirmed team members once' do
    perform

    expect(mailer).to have_received(:conversation_escalation).with(conversation, assignee).once
    expect(mailer).to have_received(:conversation_escalation).with(conversation, team_agent).once
    expect(mailer).not_to have_received(:conversation_escalation).with(conversation, unconfirmed_agent)
    expect(message_delivery).to have_received(:deliver_later).twice
    expect(account).to have_received(:increment_email_sent_count).twice
  end

  it 'stops sending when the account reaches the email rate limit' do
    allow(account).to receive(:within_email_rate_limit?).and_return(true, false)

    perform

    expect(mailer).to have_received(:conversation_escalation).once
    expect(message_delivery).to have_received(:deliver_later).once
    expect(account).to have_received(:increment_email_sent_count).once
  end

  context 'when there are no responsible agents' do
    let(:conversation) { create(:conversation, account: account) }

    it 'does not send email' do
      perform

      expect(AgentNotifications::ConversationNotificationsMailer).not_to have_received(:with)
    end
  end
end
