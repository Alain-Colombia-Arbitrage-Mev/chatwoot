import { createPinia, setActivePinia } from 'pinia';
import CaptainPreferencesAPI from 'dashboard/api/captain/preferences';
import { useCaptainConfigStore } from '../preferences';

vi.mock('dashboard/api/captain/preferences');

describe('captain preferences store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('stores runtime metadata from the preferences API', async () => {
    CaptainPreferencesAPI.get.mockResolvedValue({
      data: {
        providers: { openrouter: { display_name: 'OpenRouter' } },
        models: {},
        features: {},
        runtime: {
          name: 'Mindbliss Captain',
          provider: 'openrouter',
          model: 'upstage/solar-pro4',
        },
      },
    });

    const store = useCaptainConfigStore();
    await store.fetch();

    expect(store.getRuntime).toEqual({
      name: 'Mindbliss Captain',
      provider: 'openrouter',
      model: 'upstage/solar-pro4',
    });
  });

  it('sorts OpenRouter models first for Captain features', () => {
    const store = useCaptainConfigStore();
    store.features = {
      reply_suggestion: {
        models: [
          { id: 'gpt-4.1-mini', provider: 'openai', credit_multiplier: 3 },
          {
            id: 'upstage/solar-pro4',
            provider: 'openrouter',
            credit_multiplier: 1,
          },
        ],
      },
    };

    expect(store.getModelsForFeature('reply_suggestion')[0].id).toBe(
      'upstage/solar-pro4'
    );
  });
});
