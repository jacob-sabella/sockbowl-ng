import { Component, HostListener } from '@angular/core';
import { ThemeService } from './core/services/theme.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  title = 'sockbowl-ng';

  /** Secret UI-test gallery, opened by typing the word "clips" (see TestClipsModalComponent). */
  showClips = false;
  private keyBuffer = '';

  /**
   * Initialize ThemeService to apply theme on app startup
   */
  constructor(private themeService: ThemeService) {
    // Theme is automatically initialized in ThemeService constructor
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
