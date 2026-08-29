<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatNumber } from '@chatwoot/utils';

import Button from 'dashboard/components-next/button/Button.vue';
import Icon from 'dashboard/components-next/icon/Icon.vue';
import NextInput from 'dashboard/components-next/input/Input.vue';
import Spinner from 'dashboard/components-next/spinner/Spinner.vue';
import TimeAgo from 'dashboard/components/ui/TimeAgo.vue';
import { getLastMessage } from 'dashboard/helper/conversationHelper';

const props = defineProps({
  tickets: { type: Array, default: () => [] },
  agents: { type: Array, default: () => [] },
  teams: { type: Array, default: () => [] },
  inboxes: { type: Array, default: () => [] },
  isLoading: { type: Boolean, default: false },
  isAllMode: { type: Boolean, default: false },
  showEndOfListMessage: { type: Boolean, default: false },
});

const emit = defineEmits([
  'showAllTickets',
  'openTicket',
  'assignAgent',
  'assignTeam',
  'changePriority',
  'changeStatus',
  'loadMore',
]);

const { t } = useI18n();
const searchQuery = ref('');

const STATUS_OPTIONS = ['open', 'pending', 'snoozed', 'resolved'];
const PRIORITY_OPTIONS = ['', 'urgent', 'high', 'medium', 'low'];
const PRIORITY_RANK = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function ticketAssigneeId(ticket) {
  return Number(ticket.meta?.assignee?.id || ticket.assignee_id) || 0;
}

function ticketTeamId(ticket) {
  return Number(ticket.meta?.team?.id || ticket.team_id) || 0;
}

function ticketInbox(ticket) {
  return props.inboxes.find(inbox => inbox.id === Number(ticket.inbox_id));
}

function ticketContact(ticket) {
  return ticket.meta?.sender || {};
}

function ticketSubject(ticket) {
  const subject =
    ticket.additional_attributes?.mail_subject ||
    ticket.custom_attributes?.subject ||
    ticket.custom_attributes?.asunto ||
    '';
  const lastMessage = getLastMessage(ticket);
  return subject || lastMessage?.content || t('CHAT_LIST.NO_CONTENT');
}

function ticketLabels(ticket) {
  return (ticket.labels || [])
    .filter(label => label && !String(label).startsWith('csat'))
    .slice(0, 3);
}

function activityAt(ticket) {
  return Number(ticket.timestamp || ticket.last_activity_at || 0);
}

function priorityRank(ticket) {
  return PRIORITY_RANK[ticket.priority] ?? 9;
}

function searchableText(ticket) {
  const contact = ticketContact(ticket);
  return [
    ticket.id,
    contact.name,
    contact.email,
    contact.phone_number,
    ticketSubject(ticket),
    ticketInbox(ticket)?.name,
    ticket.meta?.assignee?.name,
    ticket.meta?.team?.name,
    ...(ticket.labels || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function ticketIdLabel(ticket) {
  return `#${ticket.display_id || ticket.id}`;
}

function labelName(label) {
  return `#${label}`;
}

function statusLabel(status) {
  switch (status) {
    case 'open':
      return t('CHAT_LIST.CHAT_STATUS_FILTER_ITEMS.open.TEXT');
    case 'pending':
      return t('CHAT_LIST.CHAT_STATUS_FILTER_ITEMS.pending.TEXT');
    case 'snoozed':
      return t('CHAT_LIST.CHAT_STATUS_FILTER_ITEMS.snoozed.TEXT');
    case 'resolved':
      return t('CHAT_LIST.CHAT_STATUS_FILTER_ITEMS.resolved.TEXT');
    default:
      return status;
  }
}

function priorityLabel(priority) {
  if (!priority) return t('CONVERSATION.PRIORITY.OPTIONS.NONE');
  switch (priority) {
    case 'urgent':
      return t('CONVERSATION.PRIORITY.OPTIONS.URGENT');
    case 'high':
      return t('CONVERSATION.PRIORITY.OPTIONS.HIGH');
    case 'medium':
      return t('CONVERSATION.PRIORITY.OPTIONS.MEDIUM');
    case 'low':
      return t('CONVERSATION.PRIORITY.OPTIONS.LOW');
    default:
      return priority;
  }
}

const routableAgents = computed(() =>
  props.agents.filter(agent => agent.confirmed !== false)
);

const visibleTickets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const tickets = query
    ? props.tickets.filter(ticket => searchableText(ticket).includes(query))
    : props.tickets;

  return [...tickets].sort((a, b) => {
    const priorityDiff = priorityRank(a) - priorityRank(b);
    if (priorityDiff !== 0) return priorityDiff;
    return activityAt(b) - activityAt(a);
  });
});

const openTicketsCount = computed(
  () => props.tickets.filter(ticket => ticket.status === 'open').length
);

const unassignedCount = computed(
  () => props.tickets.filter(ticket => !ticketAssigneeId(ticket)).length
);

const urgentCount = computed(
  () => props.tickets.filter(ticket => ticket.priority === 'urgent').length
);

const routedCount = computed(
  () =>
    props.tickets.filter(
      ticket => ticketAssigneeId(ticket) || ticketTeamId(ticket)
    ).length
);

const summaryItems = computed(() => [
  {
    key: 'all',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.ALL'),
    value: props.tickets.length,
    icon: 'i-lucide-list-checks',
  },
  {
    key: 'open',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.OPEN'),
    value: openTicketsCount.value,
    icon: 'i-lucide-inbox',
  },
  {
    key: 'unassigned',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.UNASSIGNED'),
    value: unassignedCount.value,
    icon: 'i-lucide-user-round-x',
  },
  {
    key: 'urgent',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.URGENT'),
    value: urgentCount.value,
    icon: 'i-lucide-siren',
  },
  {
    key: 'routed',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.ROUTED'),
    value: routedCount.value,
    icon: 'i-lucide-send-horizontal',
  },
]);

function onAgentChange(ticket, event) {
  const agentId = Number(event.target.value) || null;
  emit('assignAgent', { ticket, agentId });
}

function onTeamChange(ticket, event) {
  const teamId = Number(event.target.value) || null;
  emit('assignTeam', { ticket, teamId });
}

function onPriorityChange(ticket, event) {
  emit('changePriority', {
    ticket,
    priority: event.target.value || null,
  });
}

function onStatusChange(ticket, event) {
  emit('changeStatus', {
    ticket,
    status: event.target.value,
  });
}
</script>

<template>
  <section class="flex flex-col flex-1 min-h-0 bg-n-surface-1">
    <div class="px-3 py-3 border-y border-n-weak bg-n-surface-2">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start min-w-0 gap-2">
          <span
            class="inline-flex items-center justify-center flex-shrink-0 rounded-lg size-8 bg-n-brand/10 text-n-brand"
          >
            <Icon icon="i-lucide-ticket-check" class="size-4" />
          </span>
          <div class="min-w-0">
            <h2 class="m-0 text-sm font-semibold truncate text-n-slate-12">
              {{ t('CHAT_LIST.TICKET_BOARD.TITLE') }}
            </h2>
            <p class="m-0 mt-0.5 text-xs leading-5 text-n-slate-11">
              {{ t('CHAT_LIST.TICKET_BOARD.SUBTITLE') }}
            </p>
          </div>
        </div>
        <Button
          size="xs"
          color="slate"
          variant="faded"
          icon="i-lucide-refresh-cw"
          :label="
            isAllMode
              ? t('CHAT_LIST.TICKET_BOARD.ALL_MODE')
              : t('CHAT_LIST.TICKET_BOARD.SHOW_ALL')
          "
          :is-loading="isLoading && !tickets.length"
          class="flex-shrink-0"
          @click="emit('showAllTickets')"
        />
      </div>

      <div class="grid grid-cols-2 gap-2 mt-3 xl:grid-cols-5">
        <div
          v-for="item in summaryItems"
          :key="item.key"
          class="min-w-0 p-2 rounded-lg outline outline-1 outline-n-weak bg-n-alpha-1"
        >
          <div class="flex items-center gap-1.5 text-n-slate-11">
            <Icon :icon="item.icon" class="flex-shrink-0 size-3.5" />
            <span class="text-xxs font-medium uppercase truncate">
              {{ item.label }}
            </span>
          </div>
          <p class="m-0 mt-1 text-lg font-semibold text-n-slate-12">
            {{ formatNumber(item.value) }}
          </p>
        </div>
      </div>

      <NextInput
        v-model="searchQuery"
        type="search"
        size="sm"
        class="mt-3"
        custom-input-class="!ps-9"
        :placeholder="t('CHAT_LIST.TICKET_BOARD.SEARCH_PLACEHOLDER')"
      >
        <template #prefix>
          <Icon
            icon="i-lucide-search"
            class="absolute z-10 -translate-y-1/2 pointer-events-none size-4 text-n-slate-10 top-1/2 start-3"
          />
        </template>
      </NextInput>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <table class="min-w-[720px] w-full border-separate border-spacing-0">
        <thead class="sticky top-0 z-10 bg-n-surface-1">
          <tr class="text-left border-b border-n-weak">
            <th
              class="px-3 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.TICKET') }}
            </th>
            <th
              class="px-2 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.STATUS') }}
            </th>
            <th
              class="px-2 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.PRIORITY') }}
            </th>
            <th
              class="px-2 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.RESPONSIBLE') }}
            </th>
            <th
              class="px-2 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.TEAM') }}
            </th>
            <th
              class="px-2 py-2 text-xxs font-semibold uppercase text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.UPDATED') }}
            </th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="isLoading && !tickets.length">
            <td colspan="7" class="px-3 py-6 text-center text-n-slate-11">
              <Spinner class="inline-block text-n-brand" />
            </td>
          </tr>
          <tr v-else-if="!visibleTickets.length">
            <td
              colspan="7"
              class="px-3 py-6 text-center text-sm text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.EMPTY') }}
            </td>
          </tr>
          <tr
            v-for="ticket in visibleTickets"
            :key="ticket.id"
            class="group border-b cursor-pointer border-n-weak hover:bg-n-alpha-1"
            @click="emit('openTicket', ticket)"
          >
            <td class="px-3 py-3 align-top border-b border-n-weak">
              <div class="flex items-start min-w-0 gap-2">
                <span
                  class="inline-flex items-center justify-center flex-shrink-0 mt-0.5 rounded-md size-7 bg-n-slate-3 text-n-slate-11"
                >
                  {{ ticketIdLabel(ticket) }}
                </span>
                <div class="min-w-0">
                  <p class="m-0 text-sm font-medium truncate text-n-slate-12">
                    {{
                      ticketContact(ticket).name || t('CHAT_LIST.NO_CONTENT')
                    }}
                  </p>
                  <p
                    class="m-0 mt-0.5 text-xs leading-5 text-n-slate-11 line-clamp-2"
                  >
                    {{ ticketSubject(ticket) }}
                  </p>
                  <div class="flex flex-wrap gap-1 mt-2">
                    <span
                      v-if="ticketInbox(ticket)?.name"
                      class="px-1.5 py-0.5 rounded-md bg-n-slate-3 text-xxs text-n-slate-11"
                    >
                      {{ ticketInbox(ticket).name }}
                    </span>
                    <span
                      v-for="label in ticketLabels(ticket)"
                      :key="label"
                      class="px-1.5 py-0.5 rounded-md bg-n-alpha-2 text-xxs text-n-slate-11"
                    >
                      {{ labelName(label) }}
                    </span>
                  </div>
                </div>
              </div>
            </td>
            <td class="px-2 py-3 align-top border-b border-n-weak" @click.stop>
              <select
                class="w-28 h-8 px-2 text-xs border-0 rounded-lg outline outline-1 outline-n-weak bg-n-alpha-black2 text-n-slate-12"
                :value="ticket.status"
                :aria-label="t('CHAT_LIST.TICKET_BOARD.COLUMNS.STATUS')"
                @change="onStatusChange(ticket, $event)"
              >
                <option
                  v-for="status in STATUS_OPTIONS"
                  :key="status"
                  :value="status"
                >
                  {{ statusLabel(status) }}
                </option>
              </select>
            </td>
            <td class="px-2 py-3 align-top border-b border-n-weak" @click.stop>
              <select
                class="w-28 h-8 px-2 text-xs border-0 rounded-lg outline outline-1 outline-n-weak bg-n-alpha-black2 text-n-slate-12"
                :value="ticket.priority || ''"
                :aria-label="t('CHAT_LIST.TICKET_BOARD.COLUMNS.PRIORITY')"
                @change="onPriorityChange(ticket, $event)"
              >
                <option
                  v-for="priority in PRIORITY_OPTIONS"
                  :key="priority || 'none'"
                  :value="priority"
                >
                  {{ priorityLabel(priority) }}
                </option>
              </select>
            </td>
            <td class="px-2 py-3 align-top border-b border-n-weak" @click.stop>
              <select
                class="w-40 h-8 px-2 text-xs border-0 rounded-lg outline outline-1 outline-n-weak bg-n-alpha-black2 text-n-slate-12"
                :value="ticketAssigneeId(ticket) || ''"
                :aria-label="t('CHAT_LIST.TICKET_BOARD.COLUMNS.RESPONSIBLE')"
                @change="onAgentChange(ticket, $event)"
              >
                <option value="">
                  {{ t('CHAT_LIST.TICKET_BOARD.UNASSIGNED') }}
                </option>
                <option
                  v-for="agent in routableAgents"
                  :key="agent.id"
                  :value="agent.id"
                >
                  {{ agent.name }}
                </option>
              </select>
            </td>
            <td class="px-2 py-3 align-top border-b border-n-weak" @click.stop>
              <select
                class="w-36 h-8 px-2 text-xs border-0 rounded-lg outline outline-1 outline-n-weak bg-n-alpha-black2 text-n-slate-12"
                :value="ticketTeamId(ticket) || ''"
                :aria-label="t('CHAT_LIST.TICKET_BOARD.COLUMNS.TEAM')"
                @change="onTeamChange(ticket, $event)"
              >
                <option value="">
                  {{ t('CHAT_LIST.TICKET_BOARD.NO_TEAM') }}
                </option>
                <option v-for="team in teams" :key="team.id" :value="team.id">
                  {{ team.name }}
                </option>
              </select>
            </td>
            <td
              class="px-2 py-3 text-xs align-top border-b whitespace-nowrap border-n-weak text-n-slate-11"
            >
              <TimeAgo
                :conversation-id="ticket.id"
                :last-activity-timestamp="
                  ticket.timestamp || ticket.last_activity_at
                "
                :created-at-timestamp="ticket.created_at"
              />
            </td>
            <td class="px-3 py-3 align-top border-b border-n-weak">
              <Button
                size="xs"
                color="slate"
                variant="ghost"
                icon="i-lucide-panel-right-open"
                :label="t('CHAT_LIST.TICKET_BOARD.OPEN')"
                @click.stop="emit('openTicket', ticket)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      class="flex items-center justify-center flex-shrink-0 gap-3 px-3 py-3 border-t border-n-weak bg-n-surface-2"
    >
      <Button
        v-if="!showEndOfListMessage"
        size="sm"
        color="slate"
        variant="faded"
        icon="i-lucide-list-plus"
        :label="t('CHAT_LIST.LOAD_MORE_CONVERSATIONS')"
        :is-loading="isLoading"
        :disabled="isLoading"
        @click="emit('loadMore')"
      />
      <p v-else class="m-0 text-xs text-n-slate-11">
        {{ t('CHAT_LIST.EOF') }}
      </p>
    </div>
  </section>
</template>
