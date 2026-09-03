import Cookies from 'js-cookie';
import { IFrameHelper } from '../sdk/IFrameHelper';
import './sdk';

vi.mock('../sdk/IFrameHelper', () => ({
  IFrameHelper: {
    createFrame: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

describe('$chatwoot.setUser', () => {
  beforeEach(() => {
    delete window.$chatwoot;
    window.chatwootSettings = {};
    vi.spyOn(Cookies, 'get').mockReturnValue(undefined);
    vi.spyOn(Cookies, 'set').mockImplementation(() => {});

    window.chatwootSDK.run({
      baseUrl: 'https://app.chatwoot.com',
      websiteToken: 'website-token',
    });
  });

  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
    vi.restoreAllMocks();
  });

  it('updates the SDK identity synchronously', () => {
    const user = { name: 'Pranav' };

    const result = window.$chatwoot.setUser('first-user', user);

    expect(result).toBeUndefined();
    expect(window.$chatwoot.identifier).toBe('first-user');
    expect(window.$chatwoot.user).toBe(user);
    expect(IFrameHelper.sendMessage).toHaveBeenCalledWith('set-user', {
      identifier: 'first-user',
      user,
    });
  });

  it('keeps the latest identity after consecutive calls', () => {
    const firstUser = { name: 'First user' };
    const secondUser = { name: 'Second user' };

    window.$chatwoot.setUser('first-user', firstUser);
    window.$chatwoot.setUser('second-user', secondUser);

    expect(window.$chatwoot.identifier).toBe('second-user');
    expect(window.$chatwoot.user).toBe(secondUser);
    expect(IFrameHelper.sendMessage).toHaveBeenLastCalledWith('set-user', {
      identifier: 'second-user',
      user: secondUser,
    });
  });
});

describe('$chatwoot visitor prompt settings', () => {
  const runSDK = () =>
    window.chatwootSDK.run({
      baseUrl: 'https://app.chatwoot.com',
      websiteToken: 'website-token',
    });

  beforeEach(() => {
    delete window.$chatwoot;
    window.chatwootSettings = {};
    vi.spyOn(Cookies, 'get').mockImplementation(name =>
      name === 'cw_conversation' ? 'existing-conversation-token' : undefined
    );
    vi.spyOn(Cookies, 'set').mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.$chatwoot;
    delete window.chatwootSettings;
    vi.restoreAllMocks();
  });

  it('marks a visitor as returning when a conversation cookie already exists', () => {
    runSDK();

    expect(window.$chatwoot.isReturningVisitor).toBe(true);
    expect(window.$chatwoot.showBubbleNudge).toBe(true);
    expect(window.$chatwoot.bubbleNudgeDelay).toBe(1200);
    expect(window.$chatwoot.bubbleNudgeDismissAfter).toBe(12000);
  });

  it('allows the host page to override returning visitor and nudge settings', () => {
    window.chatwootSettings = {
      isReturningVisitor: false,
      showBubbleNudge: false,
      bubbleNudgeDelay: 250,
      bubbleNudgeDismissAfter: 0,
    };

    runSDK();

    expect(window.$chatwoot.isReturningVisitor).toBe(false);
    expect(window.$chatwoot.showBubbleNudge).toBe(false);
    expect(window.$chatwoot.bubbleNudgeDelay).toBe(250);
    expect(window.$chatwoot.bubbleNudgeDismissAfter).toBe(0);
  });

  it('falls back to default nudge timing when settings are invalid', () => {
    window.chatwootSettings = {
      bubbleNudgeDelay: -1,
      bubbleNudgeDismissAfter: 'soon',
    };

    runSDK();

    expect(window.$chatwoot.bubbleNudgeDelay).toBe(1200);
    expect(window.$chatwoot.bubbleNudgeDismissAfter).toBe(12000);
  });
});
