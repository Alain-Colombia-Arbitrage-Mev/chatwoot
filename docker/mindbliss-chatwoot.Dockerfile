ARG CHATWOOT_VERSION=4.17.1
FROM chatwoot/chatwoot:v${CHATWOOT_VERSION}

ARG BUILD_SHA=unknown
ARG PNPM_VERSION=10.2.0
ENV PNPM_HOME="/root/.local/share/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_OPTIONS="--max-old-space-size=4096 --openssl-legacy-provider"

WORKDIR /app

RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && npm install -g pnpm@${PNPM_VERSION}

COPY app/javascript/dashboard/api/inbox/conversation.js /app/app/javascript/dashboard/api/inbox/conversation.js
COPY app/javascript/dashboard/components-next/sidebar/Sidebar.vue /app/app/javascript/dashboard/components-next/sidebar/Sidebar.vue
COPY app/javascript/dashboard/components/ChatList.vue /app/app/javascript/dashboard/components/ChatList.vue
COPY app/javascript/dashboard/components/ChatListHeader.vue /app/app/javascript/dashboard/components/ChatListHeader.vue
COPY app/javascript/dashboard/components/SupportTicketBoard.vue /app/app/javascript/dashboard/components/SupportTicketBoard.vue
COPY app/javascript/dashboard/routes/dashboard/settings/agents/AddAgent.vue /app/app/javascript/dashboard/routes/dashboard/settings/agents/AddAgent.vue
COPY app/javascript/dashboard/i18n/locale/en/chatlist.json /app/app/javascript/dashboard/i18n/locale/en/chatlist.json
COPY app/javascript/dashboard/i18n/locale/en/settings.json /app/app/javascript/dashboard/i18n/locale/en/settings.json
COPY app/javascript/dashboard/i18n/locale/es/chatlist.json /app/app/javascript/dashboard/i18n/locale/es/chatlist.json
COPY app/javascript/dashboard/i18n/locale/es/settings.json /app/app/javascript/dashboard/i18n/locale/es/settings.json
COPY app/controllers/api/v1/accounts/agents_controller.rb /app/app/controllers/api/v1/accounts/agents_controller.rb
COPY app/controllers/concerns/conversation_custom_attributes_concern.rb /app/app/controllers/concerns/conversation_custom_attributes_concern.rb
COPY app/mailers/agent_notifications/conversation_notifications_mailer.rb /app/app/mailers/agent_notifications/conversation_notifications_mailer.rb
COPY app/services/conversations/support_escalation_notification_service.rb /app/app/services/conversations/support_escalation_notification_service.rb
COPY app/views/mailers/agent_notifications/conversation_notifications_mailer/conversation_escalation.liquid /app/app/views/mailers/agent_notifications/conversation_notifications_mailer/conversation_escalation.liquid
COPY enterprise/app/controllers/enterprise/api/v1/accounts/agents_controller.rb /app/enterprise/app/controllers/enterprise/api/v1/accounts/agents_controller.rb
COPY app/javascript/dashboard/routes/dashboard/conversation/conversation.routes.js /app/app/javascript/dashboard/routes/dashboard/conversation/conversation.routes.js
COPY app/javascript/dashboard/routes/dashboard/conversation/ConversationView.vue /app/app/javascript/dashboard/routes/dashboard/conversation/ConversationView.vue
COPY app/javascript/dashboard/store/modules/conversations/actions.js /app/app/javascript/dashboard/store/modules/conversations/actions.js

RUN pnpm i --frozen-lockfile \
  && SECRET_KEY_BASE=precompile_placeholder RAILS_LOG_TO_STDOUT=enabled bundle exec rake assets:precompile \
  && rm -rf node_modules tmp/cache

COPY deployment/mindbliss_support_agent_setup.rb /app/deployment/mindbliss_support_agent_setup.rb

RUN echo "$BUILD_SHA" > /app/.git_sha
