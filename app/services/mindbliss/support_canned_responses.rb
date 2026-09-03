# frozen_string_literal: true

module Mindbliss::SupportCannedResponses
  RESPONSES = [
    {
      short_code: 'mb_describir_problema',
      content: [
        'Hola, gracias por escribir a Mindbliss Power. Para ayudarte mejor, cuentanos en 2 o 3 frases que ocurre,',
        'desde cuando sucede y que resultado esperabas. Con esa informacion podemos revisar tu caso mas rapido.'
      ].join(' ')
    },
    {
      short_code: 'mb_datos_soporte',
      content: [
        'Para iniciar el soporte, por favor envianos tu nombre completo, telefono o WhatsApp y una descripcion corta del problema.',
        'Entre mas claro sea el detalle inicial, mas rapido podremos orientarte.'
      ].join(' ')
    },
    {
      short_code: 'mb_recibido_pronto',
      content: [
        'Gracias por la informacion. Ya tenemos tu caso registrado y el equipo de soporte lo revisara pronto.',
        'Te responderemos por este chat apenas tengamos el siguiente paso.'
      ].join(' ')
    },
    {
      short_code: 'mb_revision_caso',
      content: [
        'Entiendo la situacion. Vamos a revisar lo que nos compartiste y, si hace falta, escalaremos el caso al agente responsable.',
        'Permanece atento a este chat.'
      ].join(' ')
    },
    {
      short_code: 'mb_falta_detalle',
      content: [
        'Para avanzar, necesitamos un poco mas de detalle: que intentabas hacer, que error viste y en que cuenta, canal o producto ocurrio.',
        'Con eso podremos darte una ayuda mas precisa.'
      ].join(' ')
    }
  ].freeze

  module_function

  def provision_all!
    Account.find_each { |account| provision_account!(account) }
  end

  def provision_account!(account)
    RESPONSES.map do |response|
      canned_response = account.canned_responses.find_or_initialize_by(short_code: response.fetch(:short_code))
      canned_response.content = response.fetch(:content)
      canned_response.save! if canned_response.new_record? || canned_response.changed?
      canned_response
    end
  end
end
