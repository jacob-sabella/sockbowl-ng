import { environment } from './environment';
import { environment as prodEnvironment } from './environment.prod';

describe('environment (runtime config, AUTH-14)', () => {
  for (const [name, env] of [['environment', environment], ['environment.prod', prodEnvironment]] as const) {
    describe(name, () => {
      it('exposes apiBaseUrl as a bare origin', () => {
        expect(env.apiBaseUrl).toBeTruthy();
        const url = new URL(env.apiBaseUrl);
        expect(url.origin).toBe(env.apiBaseUrl);
      });

      it('exposes keycloak.postLogoutRedirectUri on this app', () => {
        expect(env.keycloak.postLogoutRedirectUri).toBeTruthy();
        expect(new URL(env.keycloak.postLogoutRedirectUri).origin).toBe(window.location.origin);
      });
    });
  }
});
