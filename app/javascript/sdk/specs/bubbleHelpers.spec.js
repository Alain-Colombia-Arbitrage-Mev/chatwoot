import {
  bubbleHolder,
  bubbleNudge,
  bubbleSVG,
  chatBubble,
  createBubbleHolder,
  createBubbleIcon,
  setBubbleNudge,
} from '../bubbleHelpers';

const resetBubbleElements = () => {
  document.body.innerHTML = '';
  bubbleHolder.innerHTML = '';
  bubbleHolder.className = '';
  bubbleHolder.removeAttribute('id');
  bubbleNudge.className = '';
  bubbleNudge.innerHTML = '';
  chatBubble.className = '';
  chatBubble.innerHTML = '';
  chatBubble.removeAttribute('aria-label');
  chatBubble.removeAttribute('title');
};

describe('#setBubbleNudge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBubbleElements();
    window.$chatwoot = {
      bubbleNudgeDelay: 0,
      bubbleNudgeDismissAfter: 0,
      hideMessageBubble: false,
      isOpen: false,
      position: 'right',
      showBubbleNudge: true,
      type: 'standard',
    };

    createBubbleHolder(false);
    createBubbleIcon({
      className: 'woot-widget-bubble',
      path: bubbleSVG,
      target: chatBubble,
    });
    bubbleHolder.appendChild(chatBubble);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetBubbleElements();
    delete window.$chatwoot;
  });

  it('renders a clickable nudge and updates the chat bubble label', () => {
    setBubbleNudge({
      title: 'Need help?',
      body: 'Click the bubble and tell us what you need.',
      label: 'Need help?',
    });
    vi.runOnlyPendingTimers();

    expect(chatBubble.title).toBe('Need help?');
    expect(chatBubble.getAttribute('aria-label')).toBe('Need help?');
    expect(bubbleNudge.classList.contains('woot--hide')).toBe(false);
    expect(bubbleNudge.getAttribute('aria-label')).toBe('Need help?');
    expect(
      bubbleNudge.querySelector('.woot-widget-bubble-nudge__title').innerText
    ).toBe('Need help?');
    expect(
      bubbleNudge.querySelector('.woot-widget-bubble-nudge__body').innerText
    ).toBe('Click the bubble and tell us what you need.');
  });

  it('keeps the nudge hidden for the expanded bubble layout', () => {
    window.$chatwoot.type = 'expanded_bubble';

    setBubbleNudge({
      title: 'Welcome back',
      body: 'Click to continue your case.',
      label: 'Welcome back',
    });
    vi.runOnlyPendingTimers();

    expect(bubbleNudge.classList.contains('woot--hide')).toBe(true);
  });
});
