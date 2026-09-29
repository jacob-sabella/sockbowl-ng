import ngswConfig from '../ngsw-config.json';

/**
 * M7 §3.1 item 3 / H9: on the prod path-mode deployment, ng, game, questions
 * and Keycloak all share one origin. Without a `navigationUrls` exclusion,
 * the Angular service worker treats every top-level navigation (including
 * `/auth/**`, the Keycloak hosted login page) as an SPA route and answers it
 * with `index.html` instead of letting it reach the real backend through the
 * reverse proxy -- silently breaking login. This asserts the exclusion list
 * ngsw-config.json ships, so a future edit can't drop one by accident.
 */
describe('ngsw-config.json navigationUrls (M7 §3.1 item 3, H9)', () => {
  const navigationUrls = (ngswConfig as { navigationUrls?: string[] }).navigationUrls;

  it('is present', () => {
    expect(navigationUrls).toBeDefined();
    expect(Array.isArray(navigationUrls)).toBeTrue();
  });

  it('keeps the Angular CLI default navigation matcher and its default exclusions', () => {
    expect(navigationUrls).toContain('/**');
    expect(navigationUrls).toContain('!/**/*.*');
    expect(navigationUrls).toContain('!/**/*__*');
    expect(navigationUrls).toContain('!/**/*__*/**');
  });

  it('excludes every backend path-mode prefix, so a hard navigation reaches the real service', () => {
    expect(navigationUrls).toContain('!/auth/**');
    expect(navigationUrls).toContain('!/api/**');
    expect(navigationUrls).toContain('!/questions/**');
    expect(navigationUrls).toContain('!/ws/**');
  });

  it('excludes the cast receiver page, which is loaded outside the Angular router', () => {
    expect(navigationUrls).toContain('!/cast-receiver.html');
  });
});
