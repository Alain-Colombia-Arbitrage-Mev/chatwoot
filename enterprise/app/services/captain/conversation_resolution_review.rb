# frozen_string_literal: true

class Captain::ConversationResolutionReview
  SOURCE = 'captain_inactivity_evaluation'
  REASON_LIMIT = 500

  def self.apply!(conversation, evaluation, source: SOURCE)
    new(conversation: conversation, evaluation: evaluation, source: source).apply!
  end

  def initialize(conversation:, evaluation:, source:)
    @conversation = conversation
    @evaluation = evaluation
    @source = source
  end

  def apply!
    conversation.custom_attributes = conversation.custom_attributes.to_h.merge(review_attributes)
  end

  private

  attr_reader :conversation, :evaluation, :source

  def review_attributes
    {
      'support_resolution_reviewed' => true,
      'support_resolution_reviewed_at' => reviewed_at.iso8601,
      'support_resolution_review_source' => source,
      'support_resolution_complete' => complete?,
      'support_conversation_ended' => complete?,
      'support_conversation_ended_at' => complete? ? reviewed_at.iso8601 : nil,
      'support_resolution_reason' => evaluation[:reason].to_s.truncate(REASON_LIMIT)
    }
  end

  def complete?
    evaluation[:complete] == true
  end

  def reviewed_at
    @reviewed_at ||= Time.current
  end
end
