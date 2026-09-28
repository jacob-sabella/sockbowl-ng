import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ThemeService, Theme } from '../../../core/services/theme.service';
import { Observable } from 'rxjs';

interface ThemeOption {
  value: Theme;
  label: string;
  icon: string;
}

/**
 * Theme Selector Component
 *
 * Provides a dropdown menu for selecting application theme.
 * Displays current theme with appropriate icon and allows switching between all available themes.
 */
@Component({
    selector: 'app-theme-selector',
    templateUrl: './theme-selector.component.html',
    styleUrls: ['./theme-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ThemeSelectorComponent {
  private themeService = inject(ThemeService);

  theme$: Observable<Theme>;

  /**
   * All available theme options
   */
  allThemes: ThemeOption[] = [
    {
      value: 'auto',
      label: 'Auto',
      icon: 'brightness_auto'
    },
    {
      value: 'light',
      label: 'Light',
      icon: 'light_mode'
    },
    {
      value: 'dark',
      label: 'Dark',
      icon: 'dark_mode'
    },
    {
      value: 'nord',
      label: 'Nord',
      icon: 'ac_unit'
    },
    {
      value: 'monokai',
      label: 'Monokai',
      icon: 'palette'
    },
    {
      value: 'catppuccin',
      label: 'Catppuccin',
      icon: 'local_cafe'
    },
    {
      value: 'dracula',
      label: 'Dracula',
      icon: 'nights_stay'
    },
    {
      value: 'solarized-dark',
      label: 'Solarized Dark',
      icon: 'bedtime'
    },
    {
      value: 'solarized-light',
      label: 'Solarized Light',
      icon: 'wb_sunny'
    }
  ];

  constructor() {
    this.theme$ = this.themeService.theme$;
  }

  /**
   * Set the application theme
   *
   * @param theme Theme to apply
   */
  setTheme(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  /**
   * Get the icon for the current theme
   *
   * @param theme Current theme
   * @returns Icon name for the theme
   */
  getCurrentIcon(theme: Theme): string {
    const themeOption = this.allThemes.find(t => t.value === theme);
    return themeOption ? themeOption.icon : 'palette';
  }

  /**
   * The current theme's display label (S6-09), read into the trigger's
   * `aria-describedby` text so assistive tech can announce it without
   * changing the trigger's own accessible name ("Theme selector").
   *
   * @param theme Current theme
   * @returns Label for the theme
   */
  getCurrentLabel(theme: Theme): string {
    const themeOption = this.allThemes.find(t => t.value === theme);
    return themeOption ? themeOption.label : 'Unknown';
  }

  /**
   * Check if a theme is currently active
   *
   * @param theme Theme to check
   * @param currentTheme Currently active theme
   * @returns True if theme is active
   */
  isActive(theme: Theme, currentTheme: Theme): boolean {
    return theme === currentTheme;
  }
}
