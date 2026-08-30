class Conversations::SupportEscalationNotificationService
  def initialize(conversation:)
    @conversation = conversation
    @account = conversation.account
  end

  def perform
    responsible_agents.each do |agent|
      break unless account.within_email_rate_limit?

      message_delivery = mailer.conversation_escalation(conversation, agent)
      next unless message_delivery

      message_delivery.deliver_later
      account.increment_email_sent_count
    end
  end

  private

  attr_reader :conversation, :account

  def responsible_agents
    account.users
           .where(id: responsible_agent_ids)
           .where.not(confirmed_at: nil)
           .where.not(email: [nil, ''])
  end

  def responsible_agent_ids
    ids = [conversation.assignee_id]
    ids += conversation.team.members.ids if conversation.team.present?
    ids.compact
  end

  def mailer
    @mailer ||= AgentNotifications::ConversationNotificationsMailer.with(account: account)
  end
end

Conversations::SupportEscalationNotificationService.prepend_mod_with(
  'Conversations::SupportEscalationNotificationService'
)
