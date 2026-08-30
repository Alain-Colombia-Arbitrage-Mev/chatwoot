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
COPY app/javascript/dashboard/components/ChatList.vue /app/app/javascript/dashboard/components/ChatList.vue
COPY app/javascript/dashboard/components/ChatListHeader.vue /app/app/javascript/dashboard/components/ChatListHeader.vue
COPY app/javascript/dashboard/components/SupportTicketBoard.vue /app/app/javascript/dashboard/components/SupportTicketBoard.vue
COPY app/javascript/dashboard/i18n/locale/en/chatlist.json /app/app/javascript/dashboard/i18n/locale/en/chatlist.json
COPY app/javascript/dashboard/i18n/locale/es/chatlist.json /app/app/javascript/dashboard/i18n/locale/es/chatlist.json
COPY app/javascript/dashboard/store/modules/conversations/actions.js /app/app/javascript/dashboard/store/modules/conversations/actions.js

RUN pnpm i --frozen-lockfile \
  && SECRET_KEY_BASE=precompile_placeholder RAILS_LOG_TO_STDOUT=enabled bundle exec rake assets:precompile \
  && rm -rf node_modules tmp/cache

RUN echo "$BUILD_SHA" > /app/.git_sha
