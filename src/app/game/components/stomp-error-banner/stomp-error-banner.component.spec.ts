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

  it('uses role="alert" for a fatal error and role="status" for a non-fatal one', () => {
    show({ code: 'BANNED', fatal: true });
    expect(banner()!.getAttribute('role')).toBe('alert');

    show({ code: 'RATE_LIMITED', message: 'Slow down.', fatal: false });
    expect(banner()!.getAttribute('role')).toBe('status');
  });

  it('pauses the auto-hide countdown while hovered and resumes with the remaining time', fakeAsync(() => {
    show({ code: 'RATE_LIMITED', message: 'Slow down.', fatal: false });

    tick(NON_FATAL_BANNER_MS - 1000);
    banner()!.dispatchEvent(new Event('mouseenter'));
    fixture.detectChanges();

    // Countdown is paused: waiting well past the original deadline should not hide it.
    tick(NON_FATAL_BANNER_MS * 3);
    fixture.detectChanges();
    expect(banner()).not.toBeNull();

    banner()!.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();

    // Only ~1s of the original countdown remained when the pointer entered.
    tick(999);
    fixture.detectChanges();
    expect(banner()).not.toBeNull();

    tick(1);
    fixture.detectChanges();
    expect(banner()).toBeNull();
  }));

  it('pauses the auto-hide countdown while focused and resumes on blur', fakeAsync(() => {
    show({ code: 'RATE_LIMITED', message: 'Slow down.', fatal: false });

    tick(NON_FATAL_BANNER_MS - 1000);
    banner()!.dispatchEvent(new Event('focusin'));
    fixture.detectChanges();

    tick(NON_FATAL_BANNER_MS * 3);
    fixture.detectChanges();
    expect(banner()).not.toBeNull();

    banner()!.dispatchEvent(new Event('focusout'));
    fixture.detectChanges();

    tick(1000);
    fixture.detectChanges();
    expect(banner()).toBeNull();
  }));

  it('does not resume the countdown until both hover and focus have left', fakeAsync(() => {
    show({ code: 'RATE_LIMITED', message: 'Slow down.', fatal: false });

    banner()!.dispatchEvent(new Event('mouseenter'));
    banner()!.dispatchEvent(new Event('focusin'));
    fixture.detectChanges();

    banner()!.dispatchEvent(new Event('mouseleave'));
    fixture.detectChanges();

    tick(NON_FATAL_BANNER_MS * 3);
    fixture.detectChanges();
    expect(banner()).not.toBeNull();

    banner()!.dispatchEvent(new Event('focusout'));
    fixture.detectChanges();

    tick(NON_FATAL_BANNER_MS);
    fixture.detectChanges();
    expect(banner()).toBeNull();
  }));
});
