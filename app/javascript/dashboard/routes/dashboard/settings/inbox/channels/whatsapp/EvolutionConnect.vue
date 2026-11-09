<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import InboxesAPI from 'dashboard/api/inboxes';
import NextButton from 'dashboard/components-next/button/Button.vue';
import Input from 'dashboard/components-next/input/Input.vue';

const props = defineProps({
  inboxId: { type: [Number, String], required: true },
  phoneNumber: { type: String, default: '' },
});

const emit = defineEmits(['connected', 'skip']);

const STATUS_POLL_INTERVAL_MS = 3000;
const CONNECTED_STATE = 'open';

const { t } = useI18n();

const state = ref('');
const qrCode = ref('');
const pairingCode = ref('');
const pairingNumber = ref(props.phoneNumber.replace(/\D/g, ''));
const usePairingCode = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
let pollTimer = null;

const isConnected = computed(() => state.value === CONNECTED_STATE);

const stopPolling = () => {
  clearInterval(pollTimer);
  pollTimer = null;
};

const pollStatus = async () => {
  try {
    const { data } = await InboxesAPI.getWhatsappEvolutionStatus(props.inboxId);
    state.value = data.state;
    if (isConnected.value) {
      stopPolling();
      emit('connected');
    }
  } catch {
    // Keep polling: Evolution can be briefly unavailable while it restarts the socket.
  }
};

const requestCode = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const number = usePairingCode.value ? pairingNumber.value : '';
    const { data } = await InboxesAPI.connectWhatsappEvolution(
      props.inboxId,
      number
    );
    state.value = data.state;
    qrCode.value = data.qr_code || '';
    pairingCode.value = data.pairing_code || '';
    if (!isConnected.value && !pollTimer) {
      pollTimer = setInterval(pollStatus, STATUS_POLL_INTERVAL_MS);
    }
  } catch (error) {
    errorMessage.value =
      error?.response?.data?.error ||
      t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.ERROR');
  } finally {
    isLoading.value = false;
  }
};

const toggleMode = () => {
  usePairingCode.value = !usePairingCode.value;
  qrCode.value = '';
  pairingCode.value = '';
  if (!usePairingCode.value) requestCode();
};

onMounted(requestCode);
onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="flex flex-col gap-4">
    <h2 class="text-heading-2 text-n-slate-12">
      {{ t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.TITLE') }}
    </h2>

    <p v-if="isConnected" class="text-body-main text-n-teal-11">
      {{ t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.CONNECTED') }}
    </p>

    <template v-else>
      <p v-if="errorMessage" class="text-body-main text-n-ruby-11">
        {{ errorMessage }}
      </p>

      <div v-if="usePairingCode" class="flex flex-col gap-3">
        <p class="text-body-main text-n-slate-11">
          {{ t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.PAIRING_DESC') }}
        </p>
        <div class="flex items-end gap-2">
          <Input
            v-model="pairingNumber"
            class="flex-1"
            :label="t('INBOX_MGMT.ADD.WHATSAPP.PHONE_NUMBER.LABEL')"
            placeholder="573001234567"
          />
          <NextButton
            :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.REFRESH')"
            :is-loading="isLoading"
            :disabled="!pairingNumber"
            @click="requestCode"
          />
        </div>
        <p
          v-if="pairingCode"
          class="font-mono text-3xl tracking-widest text-n-slate-12"
        >
          {{ pairingCode }}
        </p>
      </div>

      <div v-else class="flex flex-col gap-3">
        <p class="text-body-main text-n-slate-11">
          {{ t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.QR_DESC') }}
        </p>
        <img
          v-if="qrCode"
          :src="qrCode"
          alt=""
          class="size-64 rounded-lg border border-n-weak bg-white p-2"
        />
        <NextButton
          faded
          slate
          class="self-start"
          :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.REFRESH')"
          :is-loading="isLoading"
          @click="requestCode"
        />
      </div>

      <button
        type="button"
        class="self-start text-body-main text-n-brand underline"
        @click="toggleMode"
      >
        {{
          usePairingCode
            ? t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.USE_QR_CODE')
            : t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.USE_PAIRING_CODE')
        }}
      </button>
    </template>

    <div class="flex gap-2">
      <NextButton
        v-if="isConnected"
        :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.CONTINUE')"
        @click="emit('connected')"
      />
      <NextButton
        v-else
        faded
        slate
        :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.CONNECT.SKIP')"
        @click="emit('skip')"
      />
    </div>
  </div>
</template>
