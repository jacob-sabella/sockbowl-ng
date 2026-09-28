import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoadingStateComponent } from './loading-state.component';

describe('LoadingStateComponent', () => {
  let fixture: ComponentFixture<LoadingStateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LoadingStateComponent] });
    fixture = TestBed.createComponent(LoadingStateComponent);
  });

  const root = () => fixture.nativeElement.querySelector('.loading-state') as HTMLElement;
  const title = () => fixture.nativeElement.querySelector('.loading-state__title') as HTMLElement;
  const message = () => fixture.nativeElement.querySelector('.loading-state__message') as HTMLElement | null;
  const spinner = () => fixture.nativeElement.querySelector('mat-spinner') as HTMLElement | null;

  it('defaults to a generic "Loading…" title with a status role for assistive tech', () => {
    fixture.detectChanges();
    expect(root().getAttribute('role')).toBe('status');
    expect(root().getAttribute('aria-live')).toBe('polite');
    expect(title().textContent).toContain('Loading…');
    expect(spinner()).not.toBeNull();
    expect(message()).toBeNull();
  });

  it('shows a custom title and message when given one', () => {
    fixture.componentRef.setInput('title', 'Loading your packets');
    fixture.componentRef.setInput('message', 'This can take a moment on a slow connection.');
    fixture.detectChanges();

    expect(title().textContent).toContain('Loading your packets');
    expect(message()!.textContent).toContain('This can take a moment');
  });
});
