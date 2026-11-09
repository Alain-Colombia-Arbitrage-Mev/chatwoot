<script setup>
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useVuelidate } from '@vuelidate/core';
import { required, url, helpers } from '@vuelidate/validators';
import { useAlert } from 'dashboard/composables';
import { isPhoneE164OrEmpty } from 'shared/helpers/Validators';
import Banner from 'dashboard/components-next/banner/Banner.vue';
import Input from 'dashboard/components-next/input/Input.vue';
import NextButton from 'dashboard/components-next/button/Button.vue';
import EvolutionConnect from './whatsapp/EvolutionConnect.vue';

const INSTANCE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

const store = useStore();
const router = useRouter();
const { t } = useI18n();

const inboxName = ref('');
const phoneNumber = ref('');
const apiUrl = ref('');
const apiKey = ref('');
const instanceName = ref('');
const createdInboxId = ref(null);

const uiFlags = computed(() => store.getters['inboxes/getUIFlags']);

const rules = {
  inboxName: { required },
  phoneNumber: { required, isPhoneE164OrEmpty },
  apiUrl: { required, url },
  apiKey: { required },
  instanceName: {
    required,
    pattern: helpers.regex(INSTANCE_NAME_PATTERN),
  },
};
const v$ = useVuelidate(rules, {
  inboxName,
  phoneNumber,
  apiUrl,
  apiKey,
  instanceName,
});

const errorMessages = computed(() => ({
  inboxName: t('INBOX_MGMT.ADD.WHATSAPP.INBOX_NAME.ERROR'),
  phoneNumber: t('INBOX_MGMT.ADD.WHATSAPP.PHONE_NUMBER.ERROR'),
  apiUrl: t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_URL.ERROR'),
  apiKey: t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_KEY.ERROR'),
}));

const fieldMessage = field =>
  v$.value[field].$error ? errorMessages.value[field] : '';

const goToAgents = () => {
  router.replace({
    name: 'settings_inboxes_add_agents',
    params: { page: 'new', inbox_id: createdInboxId.value },
  });
};

const createChannel = async () => {
  v$.value.$touch();
  if (v$.value.$invalid) return;

  try {
    const inbox = await store.dispatch('inboxes/createChannel', {
      name: inboxName.value.trim(),
      channel: {
        type: 'whatsapp',
        provider: 'evolution',
        phone_number: phoneNumber.value,
        provider_config: {
          api_url: apiUrl.value.trim(),
          api_key: apiKey.value.trim(),
          instance_name: instanceName.value.trim(),
        },
      },
    });
    createdInboxId.value = inbox.id;
  } catch (error) {
    useAlert(error.message || t('INBOX_MGMT.ADD.WHATSAPP.API.ERROR_MESSAGE'));
  }
};
</script>

<template>
  <EvolutionConnect
    v-if="createdInboxId"
    :inbox-id="createdInboxId"
    :phone-number="phoneNumber"
    @connected="goToAgents"
    @skip="goToAgents"
  />

  <form v-else class="flex flex-col gap-4" @submit.prevent="createChannel">
    <Banner color="amber">
      {{ t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.RISK_WARNING') }}
    </Banner>

    <Input
      v-model="inboxName"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.INBOX_NAME.LABEL')"
      :placeholder="t('INBOX_MGMT.ADD.WHATSAPP.INBOX_NAME.PLACEHOLDER')"
      :message="fieldMessage('inboxName')"
      :message-type="v$.inboxName.$error ? 'error' : 'info'"
      @blur="v$.inboxName.$touch"
    />
    <Input
      v-model="phoneNumber"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.PHONE_NUMBER.LABEL')"
      :placeholder="t('INBOX_MGMT.ADD.WHATSAPP.PHONE_NUMBER.PLACEHOLDER')"
      :message="fieldMessage('phoneNumber')"
      :message-type="v$.phoneNumber.$error ? 'error' : 'info'"
      @blur="v$.phoneNumber.$touch"
    />
    <Input
      v-model="apiUrl"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_URL.LABEL')"
      :placeholder="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_URL.PLACEHOLDER')"
      :message="fieldMessage('apiUrl')"
      :message-type="v$.apiUrl.$error ? 'error' : 'info'"
      @blur="v$.apiUrl.$touch"
    />
    <Input
      v-model="apiKey"
      type="password"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_KEY.LABEL')"
      :placeholder="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.API_KEY.PLACEHOLDER')"
      :message="fieldMessage('apiKey')"
      :message-type="v$.apiKey.$error ? 'error' : 'info'"
      @blur="v$.apiKey.$touch"
    />
    <Input
      v-model="instanceName"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.INSTANCE_NAME.LABEL')"
      :placeholder="
        t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.INSTANCE_NAME.PLACEHOLDER')
      "
      :message="
        v$.instanceName.$error
          ? t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.INSTANCE_NAME.ERROR')
          : t('INBOX_MGMT.ADD.WHATSAPP.EVOLUTION.INSTANCE_NAME.HELP')
      "
      :message-type="v$.instanceName.$error ? 'error' : 'info'"
      @blur="v$.instanceName.$touch"
    />

    <NextButton
      type="submit"
      class="self-start"
      :label="t('INBOX_MGMT.ADD.WHATSAPP.SUBMIT_BUTTON')"
      :is-loading="uiFlags.isCreating"
    />
  </form>
</template>
