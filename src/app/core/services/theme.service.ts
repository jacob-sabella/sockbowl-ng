import { Injectable, Inject, DOCUMENT } from '@angular/core';
import { BehaviorSubject, Observable, fromEvent } from 'rxjs';
import { map } from 'rxjs/operators';


/**
 * Available theme options
 */
export type Theme = 'light' | 'dark' | 'nord' | 'monokai' | 'catppuccin' | 'dracula' | 'solarized-dark' | 'solarized-light' | 'auto';

/**
 * Resolved theme (auto is resolved to light or dark based on system preference)
 */
export type ResolvedTheme = Exclude<Theme, 'auto'>;

const THEME_STORAGE_KEY = 'sockbowl-theme-preference';

/**
 * Theme Service
 *
 * Manages application theme state, persistence, and switching.
 * Supports multiple themes and automatic theme based on system preference.
 */
@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private mediaQuery: MediaQueryList;
  private themeSubject: BehaviorSubject<Theme>;
  private resolvedThemeSubject: BehaviorSubject<ResolvedTheme>;

  /**
   * Observable of current theme preference (including 'auto')
   */
  public theme$: Observable<Theme>;

  /**
   * Observable of resolved theme (actual theme applied, never 'auto')
   */
  public resolvedTheme$: Observable<ResolvedTheme>;

  constructor(@Inject(DOCUMENT) private document: Document) {
    // Initialize mediaQuery first (needed for resolveTheme)
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Initialize theme subjects
    this.themeSubject = new BehaviorSubject<Theme>(this.getInitialTheme());
    this.resolvedThemeSubject = new BehaviorSubject<ResolvedTheme>(
      this.resolveTheme(this.themeSubject.value)
    );

    // Create observables
    this.theme$ = this.themeSubject.asObservable();
    this.resolvedTheme$ = this.resolvedThemeSubject.asObservable();

    // Listen to system preference changes
    fromEvent<MediaQueryListEvent>(this.mediaQuery, 'change')
      .pipe(map(() => this.resolveTheme(this.themeSubject.value)))
      .subscribe(resolved => {
        if (this.themeSubject.value === 'auto') {
          this.applyResolvedTheme(resolved);
        }
      });

    // Apply initial theme
    this.applyResolvedTheme(this.resolvedThemeSubject.value);
  }

  /**
   * Set the theme preference
   *
   * @param theme Theme to apply
   */
  setTheme(theme: Theme): void {
    this.themeSubject.next(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    const resolved = this.resolveTheme(theme);
    this.applyResolvedTheme(resolved);
  }

  /**
   * Get current theme preference
   *
   * @returns Current theme (may be 'auto')
   */
  getTheme(): Theme {
    return this.themeSubject.value;
  }

  /**
   * Get current resolved theme (actual theme applied)
   *
   * @returns Resolved theme (never 'auto')
   */
  getResolvedTheme(): ResolvedTheme {
    return this.resolvedThemeSubject.value;
  }

  /**
   * Get initial theme from localStorage or default to 'auto'
   *
   * @returns Initial theme
   */
  private getInitialTheme(): Theme {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (this.isValidTheme(stored)) {
      return stored;
    }
    // Default to dark theme for now (will be 'auto' after full implementation)
    return 'dark';
  }

  /**
   * Type guard to check if a string is a valid theme
   *
   * @param value Value to check
   * @returns True if value is a valid theme
   */
  private isValidTheme(value: string | null): value is Theme {
    return (
      value === 'light' ||
      value === 'dark' ||
      value === 'nord' ||
      value === 'monokai' ||
      value === 'catppuccin' ||
      value === 'dracula' ||
      value === 'solarized-dark' ||
      value === 'solarized-light' ||
      value === 'auto'
    );
  }

  /**
   * Resolve theme to actual light/dark based on preference and system
   *
   * @param theme Theme to resolve
   * @returns Resolved theme
   */
  private resolveTheme(theme: Theme): ResolvedTheme {
    if (theme === 'auto') {
      // Auto mode: use system preference, default to dark
      return this.mediaQuery.matches ? 'dark' : 'light';
    }
    return theme;
  }

  /**
   * Apply the resolved theme to the DOM
   *
   * @param resolved Resolved theme to apply
   */
  private applyResolvedTheme(resolved: ResolvedTheme): void {
    this.resolvedThemeSubject.next(resolved);

    const body = this.document.body;

    // Remove all theme classes
    body.classList.remove(
      'theme-light',
      'theme-dark',
      'theme-nord',
      'theme-monokai',
      'theme-catppuccin',
      'theme-dracula',
      'theme-solarized-dark',
      'theme-solarized-light'
    );

    // Add the current theme class
    body.classList.add(`theme-${resolved}`);
  }
}
