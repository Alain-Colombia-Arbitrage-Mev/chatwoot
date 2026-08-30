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
  'changeEscalation',
  'loadMore',
]);

const { t } = useI18n();
const searchQuery = ref('');
const activeBoardFilter = ref('active');

const ACTIVE_STATUSES = new Set(['open', 'pending', 'snoozed']);
const STATUS_OPTIONS = ['open', 'pending', 'snoozed', 'resolved'];
const PRIORITY_OPTIONS = ['', 'urgent', 'high', 'medium', 'low'];
const PRIORITY_RANK = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};
const ESCALATION_LABELS = new Set(['mb_ticket_escalated', 'mb_ai_escalate']);
const ESCALATION_TRUE_ATTRIBUTES = [
  'support_escalated',
  'mb_escalated',
  'ai_escalate',
];
const ESCALATION_FALSE_ATTRIBUTES = ['support_escalated', 'mb_escalated'];

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

function normalizedLabels(ticket) {
  return (ticket.labels || []).map(label => String(label).toLowerCase());
}

function activityAt(ticket) {
  return Number(ticket.timestamp || ticket.last_activity_at || 0);
}

function priorityRank(ticket) {
  return PRIORITY_RANK[ticket.priority] ?? 9;
}

function ticketIsExplicitlyNotEscalated(ticket) {
  const attrs = ticket.custom_attributes || {};
  if (
    String(attrs.support_escalation_state || '').toLowerCase() ===
    'not_escalated'
  ) {
    return true;
  }
  return ESCALATION_FALSE_ATTRIBUTES.some(key => attrs[key] === false);
}

function ticketIsEscalated(ticket) {
  if (ticketIsExplicitlyNotEscalated(ticket)) return false;

  const attrs = ticket.custom_attributes || {};
  const hasEscalationAttribute = ESCALATION_TRUE_ATTRIBUTES.some(
    key => attrs[key] === true || attrs[key] === 'true'
  );
  if (
    hasEscalationAttribute ||
    String(attrs.support_escalation_state || '').toLowerCase() === 'escalated'
  ) {
    return true;
  }

  return normalizedLabels(ticket).some(label => ESCALATION_LABELS.has(label));
}

function ticketNeedsRouting(ticket) {
  return (
    ticketIsEscalated(ticket) &&
    !ticketAssigneeId(ticket) &&
    !ticketTeamId(ticket)
  );
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

function escalationLabel(ticket) {
  return ticketIsEscalated(ticket)
    ? t('CHAT_LIST.TICKET_BOARD.ESCALATION.ESCALATED')
    : t('CHAT_LIST.TICKET_BOARD.ESCALATION.NOT_ESCALATED');
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
    escalationLabel(ticket),
    ...(ticket.labels || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function escalationIcon(ticket) {
  return ticketIsEscalated(ticket)
    ? 'i-lucide-triangle-alert'
    : 'i-lucide-shield-check';
}

function escalationBadgeClass(ticket) {
  return ticketIsEscalated(ticket)
    ? 'bg-n-amber-3 text-n-amber-11 outline-n-amber-7'
    : 'bg-n-slate-3 text-n-slate-11 outline-n-weak';
}

function matchesBoardFilter(ticket) {
  switch (activeBoardFilter.value) {
    case 'active':
      return ACTIVE_STATUSES.has(ticket.status);
    case 'pending':
      return ticket.status === 'pending';
    case 'resolved':
      return ticket.status === 'resolved';
    case 'escalated':
      return ticketIsEscalated(ticket);
    case 'unassigned':
      return !ticketAssigneeId(ticket);
    case 'all':
      return true;
    default:
      return true;
  }
}

const routableAgents = computed(() =>
  props.agents.filter(agent => agent.confirmed !== false)
);

const activeCasesCount = computed(
  () =>
    props.tickets.filter(ticket => ACTIVE_STATUSES.has(ticket.status)).length
);

const pendingCount = computed(
  () => props.tickets.filter(ticket => ticket.status === 'pending').length
);

const resolvedCount = computed(
  () => props.tickets.filter(ticket => ticket.status === 'resolved').length
);

const escalatedCount = computed(
  () => props.tickets.filter(ticket => ticketIsEscalated(ticket)).length
);

const unassignedCount = computed(
  () => props.tickets.filter(ticket => !ticketAssigneeId(ticket)).length
);

const summaryItems = computed(() => [
  {
    key: 'active',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.ACTIVE'),
    value: activeCasesCount.value,
    icon: 'i-lucide-inbox',
  },
  {
    key: 'pending',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.PENDING'),
    value: pendingCount.value,
    icon: 'i-lucide-clock-3',
  },
  {
    key: 'resolved',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.RESOLVED'),
    value: resolvedCount.value,
    icon: 'i-lucide-circle-check',
  },
  {
    key: 'escalated',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.ESCALATED'),
    value: escalatedCount.value,
    icon: 'i-lucide-triangle-alert',
  },
  {
    key: 'unassigned',
    label: t('CHAT_LIST.TICKET_BOARD.SUMMARY.UNASSIGNED'),
    value: unassignedCount.value,
    icon: 'i-lucide-user-round-x',
  },
]);

function boardFilterValue(key) {
  switch (key) {
    case 'active':
      return activeCasesCount.value;
    case 'pending':
      return pendingCount.value;
    case 'resolved':
      return resolvedCount.value;
    case 'escalated':
      return escalatedCount.value;
    case 'unassigned':
      return unassignedCount.value;
    default:
      return props.tickets.length;
  }
}

const boardFilterItems = computed(() => [
  {
    key: 'active',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.ACTIVE'),
    value: boardFilterValue('active'),
  },
  {
    key: 'pending',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.PENDING'),
    value: boardFilterValue('pending'),
  },
  {
    key: 'resolved',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.RESOLVED'),
    value: boardFilterValue('resolved'),
  },
  {
    key: 'escalated',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.ESCALATED'),
    value: boardFilterValue('escalated'),
  },
  {
    key: 'unassigned',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.UNASSIGNED'),
    value: boardFilterValue('unassigned'),
  },
  {
    key: 'all',
    label: t('CHAT_LIST.TICKET_BOARD.FILTERS.ALL'),
    value: boardFilterValue('all'),
  },
]);

const visibleTickets = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const tickets = props.tickets.filter(ticket => {
    if (!matchesBoardFilter(ticket)) return false;
    return query ? searchableText(ticket).includes(query) : true;
  });

  return [...tickets].sort((a, b) => {
    const escalationDiff =
      Number(ticketIsEscalated(b)) - Number(ticketIsEscalated(a));
    if (escalationDiff !== 0) return escalationDiff;
    const priorityDiff = priorityRank(a) - priorityRank(b);
    if (priorityDiff !== 0) return priorityDiff;
    return activityAt(b) - activityAt(a);
  });
});

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

function onEscalationChange(ticket, escalated) {
  emit('changeEscalation', { ticket, escalated });
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
            <Icon icon="i-lucide-briefcase" class="size-4" />
          </span>
          <div class="min-w-0">
            <h2 class="m-0 text-sm font-semibold truncate text-n-slate-12">
              {{ t('CHAT_LIST.TICKET_BOARD.CRM_TITLE') }}
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

      <div
        class="flex flex-wrap items-center gap-1 mt-3"
        role="tablist"
        :aria-label="t('CHAT_LIST.TICKET_BOARD.FILTER_ARIA')"
      >
        <button
          v-for="item in boardFilterItems"
          :key="item.key"
          type="button"
          class="inline-flex items-center min-w-0 h-7 gap-1.5 px-2 text-xs font-medium transition-colors border-0 rounded-lg outline outline-1"
          :class="
            activeBoardFilter === item.key
              ? 'bg-n-brand text-white outline-transparent'
              : 'bg-n-alpha-black2 text-n-slate-11 outline-n-weak hover:bg-n-alpha-2'
          "
          role="tab"
          :aria-selected="activeBoardFilter === item.key"
          @click="activeBoardFilter = item.key"
        >
          <span class="truncate">{{ item.label }}</span>
          <span
            class="px-1.5 py-0.5 rounded-md text-xxs"
            :class="
              activeBoardFilter === item.key
                ? 'bg-white/20 text-white'
                : 'bg-n-slate-3 text-n-slate-11'
            "
          >
            {{ formatNumber(item.value) }}
          </span>
        </button>
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
      <table class="min-w-[900px] w-full border-separate border-spacing-0">
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
              {{ t('CHAT_LIST.TICKET_BOARD.COLUMNS.ESCALATION') }}
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
            <td colspan="8" class="px-3 py-6 text-center text-n-slate-11">
              <Spinner class="inline-block text-n-brand" />
            </td>
          </tr>
          <tr v-else-if="!visibleTickets.length">
            <td
              colspan="8"
              class="px-3 py-6 text-center text-sm text-n-slate-11"
            >
              {{ t('CHAT_LIST.TICKET_BOARD.EMPTY') }}
            </td>
          </tr>
          <tr
            v-for="ticket in visibleTickets"
            :key="ticket.id"
            class="group border-b cursor-pointer border-n-weak hover:bg-n-alpha-1"
            :class="{ 'bg-n-amber-2': ticketNeedsRouting(ticket) }"
            @click="emit('openTicket', ticket)"
          >
            <td class="px-3 py-3 align-top border-b border-n-weak">
              <div class="flex items-start min-w-0 gap-2">
                <span
                  class="inline-flex items-center justify-center flex-shrink-0 min-w-8 h-7 px-1.5 mt-0.5 rounded-md bg-n-slate-3 text-xxs font-medium text-n-slate-11"
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
              <div class="flex flex-col items-start gap-2">
                <span
                  class="inline-flex items-center max-w-full gap-1.5 px-2 py-1 rounded-md text-xxs font-medium outline outline-1"
                  :class="escalationBadgeClass(ticket)"
                >
                  <Icon
                    :icon="escalationIcon(ticket)"
                    class="flex-shrink-0 size-3"
                  />
                  <span class="truncate">{{ escalationLabel(ticket) }}</span>
                </span>
                <span
                  v-if="ticketNeedsRouting(ticket)"
                  class="inline-flex items-center max-w-full gap-1 px-2 py-0.5 rounded-md bg-n-ruby-3 text-xxs font-medium text-n-ruby-11"
                >
                  <Icon icon="i-lucide-route" class="flex-shrink-0 size-3" />
                  <span class="truncate">
                    {{ t('CHAT_LIST.TICKET_BOARD.ESCALATION.NEEDS_ROUTING') }}
                  </span>
                </span>
                <Button
                  v-if="!ticketIsEscalated(ticket)"
                  size="xs"
                  color="amber"
                  variant="faded"
                  icon="i-lucide-send"
                  :label="t('CHAT_LIST.TICKET_BOARD.ESCALATION.ESCALATE')"
                  @click.stop="onEscalationChange(ticket, true)"
                />
                <Button
                  v-else
                  size="xs"
                  color="slate"
                  variant="faded"
                  icon="i-lucide-shield-check"
                  :label="
                    t('CHAT_LIST.TICKET_BOARD.ESCALATION.MARK_NOT_ESCALATED')
                  "
                  @click.stop="onEscalationChange(ticket, false)"
                />
              </div>
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
