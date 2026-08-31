import { usePolicy } from '../usePolicy';
import { useMapGetter } from 'dashboard/composables/store';
import { useAccount } from 'dashboard/composables/useAccount';
import { useConfig } from 'dashboard/composables/useConfig';
import { FEATURE_FLAGS } from 'dashboard/featureFlags';

vi.mock('dashboard/composables/store');
vi.mock('dashboard/composables/useAccount');
vi.mock('dashboard/composables/useConfig');

describe('usePolicy', () => {
  const enabledFeatures = new Set();

  beforeEach(() => {
    vi.clearAllMocks();
    enabledFeatures.clear();

    useAccount.mockReturnValue({
      accountId: { value: 1 },
    });
    useConfig.mockReturnValue({
      isEnterprise: true,
      enterprisePlanName: 'community',
    });
    useMapGetter.mockImplementation(getter => {
      const mockValues = {
        getCurrentUser: {
          accounts: [{ id: 1, permissions: ['administrator'] }],
        },
        'accounts/isFeatureEnabledonAccount': (_accountId, feature) =>
          enabledFeatures.has(feature),
        'globalConfig/isOnChatwootCloud': false,
        'globalConfig/isACustomBrandedInstance': false,
      };

      return { value: mockValues[getter] };
    });
  });

  it('does not show a paywall for enabled self-hosted Captain features', () => {
    enabledFeatures.add(FEATURE_FLAGS.CAPTAIN);

    const { shouldShowPaywall } = usePolicy();

    expect(shouldShowPaywall(FEATURE_FLAGS.CAPTAIN)).toBe(false);
  });

  it('keeps the enterprise paywall behavior for non-Captain premium features', () => {
    enabledFeatures.add(FEATURE_FLAGS.SLA);

    const { shouldShowPaywall } = usePolicy();

    expect(shouldShowPaywall(FEATURE_FLAGS.SLA)).toBe(true);
  });
});
