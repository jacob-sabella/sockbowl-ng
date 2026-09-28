import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [EmptyStateComponent] });
    fixture = TestBed.createComponent(EmptyStateComponent);
  });

  const title = () => fixture.nativeElement.querySelector('.empty-state__title') as HTMLElement;
  const message = () => fixture.nativeElement.querySelector('.empty-state__message') as HTMLElement | null;
  const icon = () => fixture.nativeElement.querySelector('.empty-state__icon') as HTMLElement | null;
  const action = () => fixture.nativeElement.querySelector('.empty-state__action') as HTMLButtonElement | null;

  it('renders a default title and icon with no action button when actionLabel is unset', () => {
    fixture.detectChanges();
    expect(title().textContent).toContain('Nothing here yet');
    expect(icon()).not.toBeNull();
    expect(action()).toBeNull();
  });

  it('shows the action button and emits `action` on click', () => {
    fixture.componentRef.setInput('title', 'No packets yet');
    fixture.componentRef.setInput('message', 'Create your first packet to get started.');
    fixture.componentRef.setInput('actionLabel', 'Create packet');
    fixture.detectChanges();

    const spy = jasmine.createSpy('action');
    fixture.componentInstance.action.subscribe(spy);

    expect(title().textContent).toContain('No packets yet');
    expect(message()!.textContent).toContain('Create your first packet');
    const btn = action()!;
    expect(btn.textContent).toContain('Create packet');
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('hides the icon when icon is set to an empty string', () => {
    fixture.componentRef.setInput('icon', '');
    fixture.detectChanges();
    expect(icon()).toBeNull();
  });
});
