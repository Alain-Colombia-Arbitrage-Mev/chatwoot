# frozen_string_literal: true

# Provisions the Mindbliss support AgentBot for a self-hosted Chatwoot account.
#
# Required:
#   MINDBLISS_AGENT_ACCOUNT_ID=2
#
# Optional:
#   MINDBLISS_AGENT_NAME="Mindbliss AI Support"
#   MINDBLISS_AGENT_OUTGOING_URL="http://mindbliss-support-agent:9108/webhooks/chatwoot"
#   MINDBLISS_AGENT_INBOX_IDS="all" or "1,2,3"
#   MINDBLISS_AGENT_SECRET="pre-generated-secret"
#   MINDBLISS_AGENT_OUTPUT_SECRETS="env"  # prints token/secret as env lines for root-only redirect

require 'json'

account_id = ENV.fetch('MINDBLISS_AGENT_ACCOUNT_ID')
account = Account.find(account_id)

name = ENV.fetch('MINDBLISS_AGENT_NAME', 'Mindbliss AI Support')
outgoing_url = ENV.fetch('MINDBLISS_AGENT_OUTGOING_URL', 'http://mindbliss-support-agent:9108/webhooks/chatwoot')
description = 'Mindbliss Power AI support bridge: RAG, vector memory, triage and human escalation.'

bot = account.agent_bots.find_or_initialize_by(name: name)
bot.assign_attributes(
  description: description,
  outgoing_url: outgoing_url,
  bot_type: :webhook
)
bot.secret = ENV['MINDBLISS_AGENT_SECRET'] if ENV['MINDBLISS_AGENT_SECRET'].present?
bot.save!
bot.create_access_token if bot.access_token.blank?

inbox_ids_raw = ENV.fetch('MINDBLISS_AGENT_INBOX_IDS', '')
linked_inbox_ids = []
if inbox_ids_raw.present?
  inboxes =
    if inbox_ids_raw.strip.downcase == 'all'
      account.inboxes
    else
      ids = inbox_ids_raw.split(',').map(&:strip).reject(&:blank?).map(&:to_i)
      account.inboxes.where(id: ids)
    end

  inboxes.find_each do |inbox|
    link = AgentBotInbox.find_or_initialize_by(agent_bot: bot, inbox: inbox)
    link.status = :active
    link.save!
    linked_inbox_ids << inbox.id
  end
end

if ENV['MINDBLISS_AGENT_OUTPUT_SECRETS'] == 'env'
  puts "CHATWOOT_API_ACCESS_TOKEN=#{bot.access_token.token}"
  puts "CHATWOOT_WEBHOOK_SECRET=#{bot.secret}"
else
  puts JSON.pretty_generate(
    account_id: account.id,
    agent_bot_id: bot.id,
    linked_inbox_ids: linked_inbox_ids,
    token_present: bot.access_token.token.present?,
    webhook_secret_present: bot.secret.present?
  )
end
