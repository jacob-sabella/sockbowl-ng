import {Injectable, NgZone} from '@angular/core';
import {MatSnackBar} from '@angular/material/snack-bar';

/**
 * Detects when a newer build has been deployed while this tab is open and offers
 * a one-tap reload. A running SPA keeps executing the bundle it loaded with, so
 * without this a tab left open across a deploy silently runs stale code.
 *
 * Mechanism: production bundles are content-hashed (main.<hash>.js) and
 * index.html is served with no-store, so re-fetching index.html and comparing
 * the referenced main bundle to the one this page loaded detects any deploy.
 * Checks run on an interval and whenever the tab returns to the foreground
 * (the common phone case). No build-time version file needed.
 */
@Injectable({providedIn: 'root'})
export class VersionCheckService {

  private static readonly CHECK_INTERVAL_MS = 3 * 60 * 1000;
  private static readonly BUNDLE_PATTERN = /main[.-][a-z0-9]+\.js/i;

  private runningBundle: string | null = null;
  private notified = false;
  private started = false;

  constructor(private snackBar: MatSnackBar, private zone: NgZone) {}

  start(): void {
    if (this.started || typeof document === 'undefined') {
      return;
    }
    this.started = true;
    this.runningBundle = this.detectRunningBundle();
    if (!this.runningBundle) {
      return; // dev server or unexpected markup; nothing to compare against
    }
    // Timers outside Angular so change detection isn't triggered every tick.
    this.zone.runOutsideAngular(() => {
      setInterval(() => this.check(), VersionCheckService.CHECK_INTERVAL_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.check();
        }
      });
    });
  }

  /** The main bundle this page actually loaded. */
  private detectRunningBundle(): string | null {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const s of scripts) {
      const src = s.getAttribute('src') || '';
      const match = src.match(VersionCheckService.BUNDLE_PATTERN);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  private check(): void {
    if (this.notified) {
      return;
    }
    fetch(`/index.html?vc=${Date.now()}`, {cache: 'no-store'})
      .then(r => (r.ok ? r.text() : Promise.reject(r.status)))
      .then(html => {
        const match = html.match(VersionCheckService.BUNDLE_PATTERN);
        if (match && this.runningBundle && match[0] !== this.runningBundle) {
          this.notified = true;
          this.zone.run(() => this.offerReload());
        }
      })
      .catch(() => { /* offline or transient error; try again next tick */ });
  }

  private offerReload(): void {
    const ref = this.snackBar.open(
      'A new version of Sockbowl is available.', 'Reload', {duration: 30000});
    ref.onAction().subscribe(() => location.reload());
    // If dismissed without reloading, nag gently on later checks.
    ref.afterDismissed().subscribe(info => {
      if (!info.dismissedByAction) {
        this.notified = false;
      }
    });
  }
}
