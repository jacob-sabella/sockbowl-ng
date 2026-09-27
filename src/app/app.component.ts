import { Component, HostListener, ChangeDetectionStrategy, inject } from '@angular/core';
import { ThemeService } from './core/services/theme.service';
import { VersionCheckService } from './core/version-check.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class AppComponent {
  private themeService = inject(ThemeService);

  title = 'sockbowl-ng';

  /** Secret UI-test gallery, opened by typing the word "clips" (see TestClipsModalComponent). */
  showClips = false;
  private keyBuffer = '';

  /**
   * Initialize ThemeService to apply theme on app startup
   */
  constructor() {
    const versionCheck = inject(VersionCheckService);

    // Theme is automatically initialized in ThemeService constructor
    versionCheck.start();
  }

  /** Watch for the secret word "clips" typed outside any text field. */
  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (event.key && event.key.length === 1) {
      this.keyBuffer = (this.keyBuffer + event.key.toLowerCase()).slice(-6);
      if (this.keyBuffer.endsWith('clips')) {
        this.showClips = true;
      }
    }
  }
}
