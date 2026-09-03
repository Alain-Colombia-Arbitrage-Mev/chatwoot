import { addClasses, removeClasses, toggleClass } from './DOMHelpers';
import { IFrameHelper } from './IFrameHelper';
import { isExpandedView } from './settingsHelper';
import {
  CHATWOOT_CLOSED,
  CHATWOOT_OPENED,
} from '../widget/constants/sdkEvents';
import { dispatchWindowEvent } from 'shared/helpers/CustomEventHelper';

export const bubbleSVG =
  'M240.808 240.808H122.123C56.6994 240.808 3.45695 187.562 3.45695 122.122C3.45695 56.7031 56.6994 3.45697 122.124 3.45697C187.566 3.45697 240.808 56.7031 240.808 122.122V240.808Z';

export const body = document.getElementsByTagName('body')[0];
export const widgetHolder = document.createElement('div');

export const bubbleHolder = document.createElement('div');
export const chatBubble = document.createElement('button');
export const closeBubble = document.createElement('button');
export const notificationBubble = document.createElement('span');
export const bubbleNudge = document.createElement('button');

let bubbleNudgeTimer;
let bubbleNudgeDismissTimer;

const clearBubbleNudgeTimers = () => {
  window.clearTimeout(bubbleNudgeTimer);
  window.clearTimeout(bubbleNudgeDismissTimer);
};

const setBubbleButtonLabel = label => {
  if (!label) return;

  chatBubble.title = label;
  chatBubble.setAttribute('aria-label', label);
};

export const prepareBubbleNudge = () => {
  bubbleNudge.type = 'button';
  bubbleNudge.className = `woot-widget-bubble-nudge woot-elements--${window.$chatwoot.position} woot--hide`;
};

export const setBubbleText = bubbleText => {
  if (isExpandedView(window.$chatwoot.type)) {
    const textNode = document.getElementById('woot-widget--expanded__text');
    textNode.innerText = bubbleText;
  }
};

export const hideBubbleNudge = () => {
  clearBubbleNudgeTimers();
  addClasses(bubbleNudge, 'woot--hide');
};

export const showBubbleNudge = () => {
  if (
    window.$chatwoot.hideMessageBubble ||
    !window.$chatwoot.showBubbleNudge ||
    window.$chatwoot.isOpen ||
    isExpandedView(window.$chatwoot.type)
  ) {
    return;
  }

  clearBubbleNudgeTimers();
  bubbleNudgeTimer = window.setTimeout(
    () => {
      removeClasses(bubbleNudge, 'woot--hide');

      const dismissAfter = Number(window.$chatwoot.bubbleNudgeDismissAfter);
      if (dismissAfter > 0) {
        bubbleNudgeDismissTimer = window.setTimeout(
          hideBubbleNudge,
          dismissAfter
        );
      }
    },
    Number(window.$chatwoot.bubbleNudgeDelay) || 0
  );
};

export const setBubbleNudge = ({
  title = '',
  body: message = '',
  label = '',
} = {}) => {
  setBubbleButtonLabel(label);

  if (!title && !message) {
    return;
  }

  prepareBubbleNudge();
  bubbleNudge.setAttribute('aria-label', label || title || message);
  bubbleNudge.title = label || title || message;
  bubbleNudge.innerHTML = '';

  if (title) {
    const titleEl = document.createElement('span');
    titleEl.className = 'woot-widget-bubble-nudge__title';
    titleEl.innerText = title;
    bubbleNudge.appendChild(titleEl);
  }

  if (message) {
    const bodyEl = document.createElement('span');
    bodyEl.className = 'woot-widget-bubble-nudge__body';
    bodyEl.innerText = message;
    bubbleNudge.appendChild(bodyEl);
  }

  if (bubbleHolder.childNodes.length && !bubbleNudge.parentNode) {
    bubbleHolder.insertBefore(bubbleNudge, chatBubble);
  }

  showBubbleNudge();
};

export const createBubbleIcon = ({ className, path, target }) => {
  let bubbleClassName = `${className} woot-elements--${window.$chatwoot.position}`;
  const bubbleIcon = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );
  bubbleIcon.setAttributeNS(null, 'id', 'woot-widget-bubble-icon');
  bubbleIcon.setAttributeNS(null, 'width', '24');
  bubbleIcon.setAttributeNS(null, 'height', '24');
  bubbleIcon.setAttributeNS(null, 'viewBox', '0 0 240 240');
  bubbleIcon.setAttributeNS(null, 'fill', 'none');
  bubbleIcon.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const bubblePath = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'path'
  );
  bubblePath.setAttributeNS(null, 'd', path);
  bubblePath.setAttributeNS(null, 'fill', '#FFFFFF');

  bubbleIcon.appendChild(bubblePath);
  target.appendChild(bubbleIcon);

  if (isExpandedView(window.$chatwoot.type)) {
    const textNode = document.createElement('div');
    textNode.id = 'woot-widget--expanded__text';
    textNode.innerText = '';
    target.appendChild(textNode);
    bubbleClassName += ' woot-widget--expanded';
  }

  target.className = bubbleClassName;
  target.title = 'Open chat window';
  target.setAttribute('aria-label', 'Open chat window');
  return target;
};

export const createBubbleHolder = hideMessageBubble => {
  if (hideMessageBubble) {
    addClasses(bubbleHolder, 'woot-hidden');
  }
  addClasses(bubbleHolder, 'woot--bubble-holder');
  bubbleHolder.id = 'cw-bubble-holder';
  bubbleHolder.dataset.turboPermanent = true;
  body.appendChild(bubbleHolder);
};

const handleBubbleToggle = newIsOpen => {
  IFrameHelper.events.onBubbleToggle(newIsOpen);

  if (newIsOpen) {
    dispatchWindowEvent({ eventName: CHATWOOT_OPENED });
  } else {
    dispatchWindowEvent({ eventName: CHATWOOT_CLOSED });
    chatBubble.focus();
  }
};

export const onBubbleClick = (props = {}) => {
  const { toggleValue } = props;
  const { isOpen } = window.$chatwoot;
  if (isOpen === toggleValue) return;

  const newIsOpen = toggleValue === undefined ? !isOpen : toggleValue;
  window.$chatwoot.isOpen = newIsOpen;

  hideBubbleNudge();

  toggleClass(chatBubble, 'woot--hide');
  toggleClass(closeBubble, 'woot--hide');
  toggleClass(widgetHolder, 'woot--hide');

  handleBubbleToggle(newIsOpen);
};

export const onClickChatBubble = () => {
  bubbleHolder.addEventListener('click', onBubbleClick);
};

export const addUnreadClass = () => {
  const holderEl = document.querySelector('.woot-widget-holder');
  addClasses(holderEl, 'has-unread-view');
};

export const removeUnreadClass = () => {
  const holderEl = document.querySelector('.woot-widget-holder');
  removeClasses(holderEl, 'has-unread-view');
};
