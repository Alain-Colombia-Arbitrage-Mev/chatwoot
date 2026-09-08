import {
  getLoginRedirectURL,
  getCredentialsFromEmail,
  rememberLoginRedirect,
  consumeLoginRedirect,
} from '../AuthHelper';

describe('#URL Helpers', () => {
  beforeEach(() => window.sessionStorage.clear());

  describe('account login destinations', () => {
    const user = { accounts: [{ id: 2, role: 'agent', status: 'active' }] };

    it('restores a conversation after login and consumes the saved destination', () => {
      rememberLoginRedirect('/app/accounts/2/conversations/41?messageId=7');
      expect(consumeLoginRedirect(user)).toBe(
        '/app/accounts/2/conversations/41?messageId=7'
      );
      expect(consumeLoginRedirect(user)).toBeNull();
    });

    it('does not redirect to another company', () => {
      rememberLoginRedirect('/app/accounts/3/support/tickets');
      expect(consumeLoginRedirect(user)).toBeNull();
    });

    it.each([
      'https://example.com/app/accounts/2/conversations/41',
      '//example.com/app/accounts/2/conversations/41',
      '/app/accounts/2/../../login',
      '/app/accounts/2/%2e%2e/3/conversations/41',
      '/app/accounts/2/\\example.com',
    ])('rejects an unsafe destination: %s', path => {
      rememberLoginRedirect(path);
      expect(consumeLoginRedirect(user)).toBeNull();
    });

    it('opens the company tickets for a support agent signing in normally', () => {
      expect(getLoginRedirectURL({ user })).toBe(
        '/app/accounts/2/support/tickets'
      );
    });

    it('never reuses a conversation id from an inaccessible SSO account', () => {
      expect(
        getLoginRedirectURL({
          ssoAccountId: '3',
          ssoConversationId: '41',
          user,
        })
      ).toBe('/app/accounts/2/support/tickets');
    });

    it('does not use a stale account_id absent from the account memberships', () => {
      expect(getLoginRedirectURL({ user: { ...user, account_id: 3 } })).toBe(
        '/app/accounts/2/support/tickets'
      );
    });
  });

  describe('getLoginRedirectURL', () => {
    it('should return correct Account URL if account id is present', () => {
      expect(
        getLoginRedirectURL({
          ssoAccountId: '7500',
          user: {
            accounts: [{ id: 7500, name: 'Test Account 7500' }],
          },
        })
      ).toBe('/app/accounts/7500/dashboard');
    });

    it('should return correct conversation URL if account id and conversationId is present', () => {
      expect(
        getLoginRedirectURL({
          ssoAccountId: '7500',
          ssoConversationId: '752',
          user: {
            accounts: [{ id: 7500, name: 'Test Account 7500' }],
          },
        })
      ).toBe('/app/accounts/7500/conversations/752');
    });

    it('should return default URL if account id is not present', () => {
      expect(getLoginRedirectURL({ ssoAccountId: '7500', user: {} })).toBe(
        '/app/'
      );
      expect(
        getLoginRedirectURL({
          ssoAccountId: '7500',
          user: {
            accounts: [{ id: '7501', name: 'Test Account 7501' }],
          },
        })
      ).toBe('/app/accounts/7501/dashboard');
      expect(getLoginRedirectURL('7500', null)).toBe('/app/');
    });
  });

  describe('getCredentialsFromEmail', () => {
    it('should capitalize fullName and accountName from a standard email', () => {
      expect(getCredentialsFromEmail('john@company.com')).toEqual({
        fullName: 'John',
        accountName: 'Company',
      });
    });

    it('should handle subdomains by using the first part of the domain', () => {
      expect(getCredentialsFromEmail('jane@mail.example.org')).toEqual({
        fullName: 'Jane',
        accountName: 'Mail',
      });
    });

    it('should split by dots and capitalize each word', () => {
      expect(getCredentialsFromEmail('john.doe@acme.co')).toEqual({
        fullName: 'John Doe',
        accountName: 'Acme',
      });
    });

    it('should omit everything after + in the local part', () => {
      expect(getCredentialsFromEmail('user+tag@startup.io')).toEqual({
        fullName: 'User',
        accountName: 'Startup',
      });
    });

    it('should split by underscores and hyphens', () => {
      expect(getCredentialsFromEmail('first_last@my-company.com')).toEqual({
        fullName: 'First Last',
        accountName: 'My Company',
      });
    });
  });
});
