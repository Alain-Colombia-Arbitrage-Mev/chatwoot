module ConversationCustomAttributesConcern
  BOOLEAN_TYPE = ActiveModel::Type::Boolean.new
  SUPPORT_ESCALATION_TRUE_KEYS = %w[support_escalated mb_escalated ai_escalate].freeze
  SUPPORT_ESCALATION_FALSE_KEYS = %w[support_escalated mb_escalated].freeze

  def custom_attributes
    previous_attributes = @conversation.custom_attributes&.dup
    attributes = params.permit(custom_attributes: {})[:custom_attributes]
    # When `merge` is truthy, only the keys sent are updated and the rest are kept, matching the contacts endpoint.
    # Replace stays the default so existing integrations are unaffected.
    attributes = (@conversation.custom_attributes || {}).merge(attributes || {}) if BOOLEAN_TYPE.cast(params[:merge])
    @conversation.custom_attributes = attributes
    @conversation.save!
    notify_support_escalation(previous_attributes)
  end

  def destroy_custom_attributes
    @conversation.custom_attributes = @conversation.custom_attributes.excluding(params[:custom_attributes])
    @conversation.save!
  end

  private

  def notify_support_escalation(previous_attributes)
    return unless support_escalated?(@conversation.custom_attributes)
    return if support_escalated?(previous_attributes)

    Conversations::SupportEscalationNotificationService.new(conversation: @conversation).perform
  end

  def support_escalated?(attributes)
    attributes = (attributes || {}).with_indifferent_access

    return false if attributes[:support_escalation_state].to_s.casecmp('not_escalated').zero?
    return false if support_escalation_false_attribute?(attributes)
    return true if attributes[:support_escalation_state].to_s.casecmp('escalated').zero?

    SUPPORT_ESCALATION_TRUE_KEYS.any? { |key| BOOLEAN_TYPE.cast(attributes[key]) }
  end

  def support_escalation_false_attribute?(attributes)
    SUPPORT_ESCALATION_FALSE_KEYS.any? do |key|
      attributes.key?(key) && BOOLEAN_TYPE.cast(attributes[key]) == false
    end
  end
end
