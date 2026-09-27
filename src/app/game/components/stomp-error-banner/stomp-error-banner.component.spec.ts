import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';

import { NON_FATAL_BANNER_MS, StompErrorBannerComponent } from './stomp-error-banner.component';
import { StompError } from '../../models/sockbowl/sockbowl-interfaces';

describe('StompErrorBannerComponent', () => {
  let fixture: ComponentFixture<StompErrorBannerComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StompErrorBannerComponent] });
    fixture = TestBed.createComponent(StompErrorBannerComponent);
  });

  function show(error: StompError | null): void {
    fixture.componentRef.setInput('error', error);
    fixture.detectChanges();
  }

  const banner = () => fixture.nativeElement.querySelector('[data-testid="stomp-error-banner"]') as HTMLElement | null;

  it('keeps a fatal error on screen until dismissed', fakeAsync(() => {
    show({ code: 'BANNED', fatal: true });
    tick(NON_FATAL_BANNER_MS * 3);
    fixture.detectChanges();

    expect(banner()).not.toBeNull();
    expect(banner()!.classList).toContain('fatal');
    expect(banner()!.textContent).toContain('banned');

    (banner()!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(banner()).toBeNull();
  }));

  it('hides a non-fatal error after 5s and shows retryAfterSeconds', fakeAsync(() => {
    show({ code: 'RATE_LIMITED', message: 'Slow down.', retryAfterSeconds: 4, fatal: false });

    expect(banner()!.textContent).toContain('Slow down.');
    expect(banner()!.textContent).toContain('4s');

    tick(NON_FATAL_BANNER_MS);
    fixture.detectChanges();
    expect(banner()).toBeNull();
  }));

  it('shows nothing without an error', () => {
    show(null);
    expect(banner()).toBeNull();
  });
});
