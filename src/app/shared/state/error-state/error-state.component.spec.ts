import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ErrorStateComponent } from './error-state.component';

describe('ErrorStateComponent', () => {
  let fixture: ComponentFixture<ErrorStateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ErrorStateComponent] });
    fixture = TestBed.createComponent(ErrorStateComponent);
  });

  const root = () => fixture.nativeElement.querySelector('.error-state') as HTMLElement;
  const title = () => fixture.nativeElement.querySelector('.error-state__title') as HTMLElement;
  const action = () => fixture.nativeElement.querySelector('.error-state__action') as HTMLButtonElement | null;

  it('defaults to a generic title with an alert role and a Retry button', () => {
    fixture.detectChanges();
    expect(root().getAttribute('role')).toBe('alert');
    expect(title().textContent).toContain('Something went wrong');
    expect(action()!.textContent).toContain('Retry');
  });

  it('emits `retry` on click and supports a relabeled action (e.g. Sign In)', () => {
    fixture.componentRef.setInput('title', 'Signed out');
    fixture.componentRef.setInput('message', 'Your session ended.');
    fixture.componentRef.setInput('actionLabel', 'Sign In');
    fixture.detectChanges();

    const spy = jasmine.createSpy('retry');
    fixture.componentInstance.retry.subscribe(spy);

    const btn = action()!;
    expect(btn.textContent).toContain('Sign In');
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('hides the action button when actionLabel is null', () => {
    fixture.componentRef.setInput('actionLabel', null);
    fixture.detectChanges();
    expect(action()).toBeNull();
  });
});
