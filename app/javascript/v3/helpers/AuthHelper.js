import Cookies from 'js-cookie';
import { DEFAULT_REDIRECT_URL } from 'dashboard/constants/globals';
import { frontendURL } from 'dashboard/helper/URLHelper';
import { SESSION_STORAGE_KEYS } from 'dashboard/constants/sessionStorage';
import SessionStorage from 'shared/helpers/sessionStorage';

const accountRedirect = path => {
  if (typeof path !== 'string' || /[\\\s]/.test(path)) return null;
  const match = path.match(/^\/app\/accounts\/([1-9]\d*)(?:\/|$)/);
  if (!match) return null;
  const url = new URL(path, 'https://chatwoot.invalid');
  // Reject normalized traversal paths instead of changing the target company.
  if (url.pathname !== path.split(/[?#]/)[0]) return null;
  return { path, accountId: Number(match[1]) };
};

export const rememberLoginRedirect = path => {
  const target = accountRedirect(path);
  if (target)
    SessionStorage.set(SESSION_STORAGE_KEYS.LOGIN_REDIRECT, target.path);
};

export const consumeLoginRedirect = user => {
  const storedPath = SessionStorage.get(SESSION_STORAGE_KEYS.LOGIN_REDIRECT);
  SessionStorage.remove(SESSION_STORAGE_KEYS.LOGIN_REDIRECT);
  const target = accountRedirect(storedPath);
  return target &&
    user?.accounts?.some(
      account =>
        Number(account.id) === target.accountId && account.status === 'active'
    )
    ? target.path
    : null;
};

export const hasAuthCookie = () => {
  return !!Cookies.get('cw_d_session_info');
};

const getSSOAccountPath = ({ ssoAccountId, user }) => {
  const { accounts = [], account_id = null } = user || {};
  const ssoAccount = accounts.find(
    account => account.id === Number(ssoAccountId)
  );
  let accountPath = '';
  if (ssoAccount) {
    accountPath = `accounts/${ssoAccountId}`;
  } else if (accounts.length) {
    // If the account id is not found, redirect to the first account
    const accountId =
      accounts.find(account => Number(account.id) === Number(account_id))?.id ||
      accounts[0].id;
    accountPath = `accounts/${accountId}`;
  }
  return accountPath;
};

const capitalize = str =>
  str
    .split(/[._-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const getCredentialsFromEmail = email => {
  const [localPart, domain] = email.split('@');
  const namePart = localPart.split('+')[0];
  return {
    fullName: capitalize(namePart),
    accountName: capitalize(domain.split('.')[0]),
  };
};

export const getLoginRedirectURL = ({
  ssoAccountId,
  ssoConversationId,
  user,
}) => {
  const accountPath = getSSOAccountPath({ ssoAccountId, user });
  if (accountPath) {
    const selectedAccount = user?.accounts?.find(
      account => Number(account.id) === Number(ssoAccountId)
    );
    if (selectedAccount && /^[1-9]\d*$/.test(String(ssoConversationId))) {
      return frontendURL(`${accountPath}/conversations/${ssoConversationId}`);
    }
    const accountId = Number(accountPath.split('/')[1]);
    const account = user?.accounts?.find(a => Number(a.id) === accountId);
    const destination =
      account?.role === 'agent' ? 'support/tickets' : 'dashboard';
    return frontendURL(`${accountPath}/${destination}`);
  }
  return DEFAULT_REDIRECT_URL;
};
