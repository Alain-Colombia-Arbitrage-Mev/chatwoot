<script setup>
import { computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useAlert } from 'dashboard/composables';
import { useAccount } from 'dashboard/composables/useAccount';
import { useCaptain } from 'dashboard/composables/useCaptain';
import { useConfig } from 'dashboard/composables/useConfig';
import { useCaptainConfigStore } from 'dashboard/store/captain/preferences';

import SettingsLayout from '../SettingsLayout.vue';
import BaseSettingsHeader from '../components/BaseSettingsHeader.vue';
import SectionLayout from '../account/components/SectionLayout.vue';
import ModelSelector from './components/ModelSelector.vue';
import FeatureToggle from './components/FeatureToggle.vue';

const { t } = useI18n();
const { captainEnabled } = useCaptain();
const { isEnterprise, enterprisePlanName } = useConfig();
const { isOnChatwootCloud } = useAccount();

const captainConfigStore = useCaptainConfigStore();
const { runtime, uiFlags } = storeToRefs(captainConfigStore);

const isLoading = computed(() => uiFlags.value.isFetching);
const isMindblissCaptain = computed(
  () => !isOnChatwootCloud.value && isEnterprise
);
const isCaptainVisible = computed(
  () => captainEnabled.value || isMindblissCaptain.value
);

const providerLabel = computed(() => {
  return (
    runtime.value?.provider_display_name ||
    runtime.value?.provider ||
    'OpenRouter'
  );
});

const runtimeCards = computed(() => [
  {
    key: 'llm',
    icon: 'i-lucide-route',
    label: t('CAPTAIN_SETTINGS.RUNTIME.PROVIDER'),
    value: `${providerLabel.value} / ${
      runtime.value?.model || 'upstage/solar-pro4'
    }`,
    status: runtime.value?.openrouter_configured
      ? t('CAPTAIN_SETTINGS.RUNTIME.OPENROUTER_READY')
      : t('CAPTAIN_SETTINGS.RUNTIME.OPENROUTER_MISSING'),
    ready: !!runtime.value?.openrouter_configured,
  },
  {
    key: 'memory',
    icon: 'i-lucide-database',
    label: t('CAPTAIN_SETTINGS.RUNTIME.MEMORY'),
    value: `${runtime.value?.memory?.vector_store || 'Qdrant'} + ${
      runtime.value?.memory?.graph_store || 'FalkorDB'
    }`,
    status: t('CAPTAIN_SETTINGS.RUNTIME.ACTIVE'),
    ready: true,
  },
  {
    key: 'reranker',
    icon: 'i-lucide-list-filter',
    label: t('CAPTAIN_SETTINGS.RUNTIME.RERANKER'),
    value: runtime.value?.memory?.reranker || 'OpenRouter reranker',
    status: t('CAPTAIN_SETTINGS.RUNTIME.ACTIVE'),
    ready: true,
  },
  {
    key: 'guardrails',
    icon: 'i-lucide-shield-check',
    label: t('CAPTAIN_SETTINGS.RUNTIME.GUARDRAILS'),
    value: t('CAPTAIN_SETTINGS.RUNTIME.GROUNDED'),
    status: t('CAPTAIN_SETTINGS.RUNTIME.ACTIVE'),
    ready: !!runtime.value?.guardrails?.grounded,
  },
]);

const modelFeatures = computed(() => [
  {
    key: 'editor',
    title: t('CAPTAIN_SETTINGS.MODEL_CONFIG.EDITOR.TITLE'),
    description: t('CAPTAIN_SETTINGS.MODEL_CONFIG.EDITOR.DESCRIPTION'),
  },
  {
    key: 'reply_suggestion',
    title: t('CAPTAIN_SETTINGS.MODEL_CONFIG.REPLY_SUGGESTION.TITLE'),
    description: t(
      'CAPTAIN_SETTINGS.MODEL_CONFIG.REPLY_SUGGESTION.DESCRIPTION'
    ),
  },
  {
    key: 'assistant',
    title: t('CAPTAIN_SETTINGS.MODEL_CONFIG.ASSISTANT.TITLE'),
    description: t('CAPTAIN_SETTINGS.MODEL_CONFIG.ASSISTANT.DESCRIPTION'),
    enterprise: true,
  },
  {
    key: 'copilot',
    title: t('CAPTAIN_SETTINGS.MODEL_CONFIG.COPILOT.TITLE'),
    description: t('CAPTAIN_SETTINGS.MODEL_CONFIG.COPILOT.DESCRIPTION'),
    enterprise: true,
  },
]);

const featureToggles = computed(() => [
  {
    key: 'label_suggestion',
  },
  {
    key: 'help_center_search',
    enterprise: true,
  },
  {
    key: 'audio_transcription',
    enterprise: true,
  },
]);

const shouldShowFeature = feature => {
  if (isMindblissCaptain.value) {
    return true;
  }

  // Cloud will always see these features as long as captain is enabled
  if (isOnChatwootCloud.value && captainEnabled.value) {
    return true;
  }

  if (feature.enterprise) {
    // if the app is in enterprise mode, then we can show the feature
    // this is not the installation plan, but when the enterprise folder is missing
    return isEnterprise;
  }

  return true;
};

const isFeatureAccessible = feature => {
  if (isMindblissCaptain.value) {
    return true;
  }

  // Cloud will always see these features as long as captain is enabled
  if (isOnChatwootCloud.value && captainEnabled.value) {
    return true;
  }

  if (feature.enterprise) {
    // plan is shown, but is it accessible?
    // This ensures that the instance has purchased the enterprise license, and only then we allow
    // access
    return isEnterprise && enterprisePlanName === 'enterprise';
  }

  return true;
};

async function handleFeatureToggle({ feature, enabled }) {
  try {
    await captainConfigStore.updatePreferences({
      captain_features: { [feature]: enabled },
    });
    useAlert(t('CAPTAIN_SETTINGS.API.SUCCESS'));
  } catch (error) {
    useAlert(t('CAPTAIN_SETTINGS.API.ERROR'));
    captainConfigStore.fetch();
  }
}

async function handleModelChange({ feature, model }) {
  try {
    await captainConfigStore.updatePreferences({
      captain_models: { [feature]: model },
    });
    useAlert(t('CAPTAIN_SETTINGS.API.SUCCESS'));
  } catch (error) {
    useAlert(t('CAPTAIN_SETTINGS.API.ERROR'));
    captainConfigStore.fetch();
  }
}

onMounted(() => {
  captainConfigStore.fetch();
});
</script>

<template>
  <SettingsLayout
    :is-loading="isLoading"
    :no-records-message="t('CAPTAIN_SETTINGS.NOT_ENABLED')"
    :loading-message="t('CAPTAIN_SETTINGS.LOADING')"
  >
    <template #header>
      <BaseSettingsHeader
        :title="t('CAPTAIN_SETTINGS.TITLE')"
        :description="t('CAPTAIN_SETTINGS.DESCRIPTION')"
        :link-text="t('CAPTAIN_SETTINGS.LINK_TEXT')"
        icon-name="captain"
        feature-name="captain"
      />
    </template>
    <template #body>
      <div v-if="isCaptainVisible" class="flex flex-col gap-1">
        <SectionLayout
          :title="t('CAPTAIN_SETTINGS.RUNTIME.TITLE')"
          :description="t('CAPTAIN_SETTINGS.RUNTIME.DESCRIPTION')"
        >
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div
              v-for="item in runtimeCards"
              :key="item.key"
              class="flex items-start gap-3 p-4 border rounded-lg border-n-weak bg-n-solid-1 min-w-0"
            >
              <span
                class="mt-0.5 size-4 flex-shrink-0 text-n-slate-11"
                :class="item.icon"
              />
              <div class="grid gap-1 min-w-0">
                <span class="text-xs font-medium uppercase text-n-slate-10">
                  {{ item.label }}
                </span>
                <span class="text-sm font-medium text-n-slate-12 break-words">
                  {{ item.value }}
                </span>
                <span
                  class="text-xs"
                  :class="item.ready ? 'text-n-teal-11' : 'text-n-amber-11'"
                >
                  {{ item.status }}
                </span>
              </div>
            </div>
          </div>
        </SectionLayout>

        <!-- Model Configuration Section -->
        <SectionLayout
          :title="t('CAPTAIN_SETTINGS.MODEL_CONFIG.TITLE')"
          :description="t('CAPTAIN_SETTINGS.MODEL_CONFIG.DESCRIPTION')"
          with-border
        >
          <div class="grid gap-4">
            <ModelSelector
              v-for="feature in modelFeatures"
              v-show="shouldShowFeature(feature)"
              :key="feature.key"
              :is-allowed="isFeatureAccessible(feature)"
              :feature-key="feature.key"
              :title="feature.title"
              :description="feature.description"
              @change="handleModelChange"
            />
          </div>
        </SectionLayout>

        <!-- Features Section -->
        <SectionLayout
          :title="t('CAPTAIN_SETTINGS.FEATURES.TITLE')"
          :description="t('CAPTAIN_SETTINGS.FEATURES.DESCRIPTION')"
          with-border
        >
          <div class="grid gap-4">
            <FeatureToggle
              v-for="feature in featureToggles"
              v-show="shouldShowFeature(feature)"
              :key="feature.key"
              :is-allowed="isFeatureAccessible(feature)"
              :feature-key="feature.key"
              @change="handleFeatureToggle"
              @model-change="handleModelChange"
            />
          </div>
        </SectionLayout>
      </div>
      <div v-else>
        <p class="text-sm text-n-slate-11">
          {{ t('CAPTAIN_SETTINGS.NOT_ENABLED') }}
        </p>
      </div>
    </template>
  </SettingsLayout>
</template>
