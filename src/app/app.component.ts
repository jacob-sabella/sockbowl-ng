import { Component } from '@angular/core';
import { ThemeService } from './core/services/theme.service';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false
})
export class AppComponent {
  title = 'sockbowl-ng';

  /**
   * Initialize ThemeService to apply theme on app startup
   */
  constructor(private themeService: ThemeService) {
    // Theme is automatically initialized in ThemeService constructor
  }
}
