import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const THEME_STORAGE_KEY = 'sockbowl-theme-preference';

describe('ThemeService', () => {
  let metaEl: HTMLMetaElement;

  beforeEach(() => {
    metaEl = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;
    if (!metaEl) {
      metaEl = document.createElement('meta');
      metaEl.setAttribute('name', 'theme-color');
      document.head.appendChild(metaEl);
    }
    metaEl.setAttribute('content', '#000000');

    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    document.body.classList.remove(
      'theme-light',
      'theme-dark',
      'theme-nord',
      'theme-monokai',
      'theme-catppuccin',
      'theme-dracula',
      'theme-solarized-dark',
      'theme-solarized-light'
    );
  });

  it('defaults to the dark theme when nothing is stored (M5 default: keep dark as the boot default)', () => {
    spyOn(localStorage, 'getItem').and.returnValue(null);
    const service = TestBed.inject(ThemeService);

    expect(service.getTheme()).toBe('dark');
    expect(service.getResolvedTheme()).toBe('dark');
  });

  it('reads a previously-stored preference on boot', () => {
    spyOn(localStorage, 'getItem').and.returnValue('nord');
    const service = TestBed.inject(ThemeService);

    expect(service.getTheme()).toBe('nord');
  });

  it('boots with the default theme even when localStorage.getItem throws (F1-21)', () => {
    spyOn(localStorage, 'getItem').and.throwError('blocked');

    let service!: ThemeService;
    expect(() => (service = TestBed.inject(ThemeService))).not.toThrow();
    expect(service.getTheme()).toBe('dark');
  });

  it('setTheme does not throw when localStorage.setItem throws, and still applies in-memory (F1-21)', () => {
    const service = TestBed.inject(ThemeService);
    spyOn(localStorage, 'setItem').and.throwError('blocked');

    expect(() => service.setTheme('monokai')).not.toThrow();
    expect(service.getTheme()).toBe('monokai');
    expect(document.body.classList).toContain('theme-monokai');
  });

  it('persists the theme preference to localStorage', () => {
    const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();
    const service = TestBed.inject(ThemeService);

    service.setTheme('catppuccin');

    expect(setItemSpy).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'catppuccin');
  });

  it("updates the theme-color meta tag to the resolved theme's --bg-primary (F1-15)", () => {
    const service = TestBed.inject(ThemeService);

    service.setTheme('light');
    const lightBg = getComputedStyle(document.body).getPropertyValue('--bg-primary').trim();
    expect(lightBg).not.toBe('');
    expect(metaEl.getAttribute('content')).toBe(lightBg);

    service.setTheme('dark');
    const darkBg = getComputedStyle(document.body).getPropertyValue('--bg-primary').trim();
    expect(metaEl.getAttribute('content')).toBe(darkBg);
    expect(darkBg).not.toBe(lightBg);
  });
});
