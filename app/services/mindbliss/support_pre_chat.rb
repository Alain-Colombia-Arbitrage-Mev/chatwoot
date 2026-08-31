# frozen_string_literal: true

module Mindbliss::SupportPreChat
  INITIAL_PROBLEM_ATTRIBUTE = 'initial_problem_description'
  DEFAULT_MESSAGE = 'Para iniciar el soporte, dejanos tu nombre completo, telefono o WhatsApp y una descripcion corta del problema.'
  STANDARD_FIELD_NAMES = %w[emailAddress fullName phoneNumber].freeze

  STANDARD_FIELDS = {
    'emailAddress' => {
      'field_type' => 'standard',
      'label' => 'Email Id',
      'placeholder' => 'Correo electronico opcional',
      'name' => 'emailAddress',
      'type' => 'email',
      'required' => false,
      'enabled' => false
    },
    'fullName' => {
      'field_type' => 'standard',
      'label' => 'Nombre completo',
      'placeholder' => 'Escribe tu nombre y apellido',
      'name' => 'fullName',
      'type' => 'text',
      'required' => true,
      'enabled' => true
    },
    'phoneNumber' => {
      'field_type' => 'standard',
      'label' => 'Telefono o WhatsApp',
      'placeholder' => 'Ej: +57 300 123 4567',
      'name' => 'phoneNumber',
      'type' => 'text',
      'required' => true,
      'enabled' => true
    }
  }.freeze

  module_function

  def default_options(existing_options = {})
    options = normalize_options(existing_options)
    return mandatory_options(options) if options['pre_chat_fields'].blank?

    options
  end

  def mandatory_options(existing_options = {})
    options = normalize_options(existing_options)

    {
      'pre_chat_message' => options['pre_chat_message'].presence || DEFAULT_MESSAGE,
      'pre_chat_fields' => merged_fields(Array(options['pre_chat_fields']))
    }
  end

  def merged_fields(fields)
    existing_fields = fields.filter_map { |field| normalize_field(field) }
    existing_by_name = existing_fields.index_by { |field| field['name'] }
    standard_fields = STANDARD_FIELD_NAMES.map do |name|
      STANDARD_FIELDS.fetch(name).merge(existing_by_name[name] || {}).merge(required_overrides(name))
    end
    custom_fields = existing_fields.reject { |field| STANDARD_FIELD_NAMES.include?(field['name']) }

    standard_fields + custom_fields
  end

  def normalize_options(options)
    return {} unless options.respond_to?(:to_h)

    options.to_h.deep_stringify_keys
  end

  def normalize_field(field)
    return unless field.respond_to?(:to_h)

    normalized = field.to_h.deep_stringify_keys
    normalized['name'].present? ? normalized : nil
  end

  def required_overrides(name)
    return {} unless %w[fullName phoneNumber].include?(name)

    {
      'label' => STANDARD_FIELDS.fetch(name).fetch('label'),
      'placeholder' => STANDARD_FIELDS.fetch(name).fetch('placeholder'),
      'required' => true,
      'enabled' => true
    }
  end
end
