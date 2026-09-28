import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

/**
 * NG-V1-03: the builder's Question/Answer `<mat-error>`s were wrapped in a
 * plain `@if (!value.trim())`, but the `<textarea>` had no `required` (or
 * any other validator), so its `NgModel` was never actually invalid.
 * `MatFormField` only projects a `mat-error` into the DOM when its control's
 * `errorState` is true (`invalid && touched`, by the default
 * `ErrorStateMatcher`) — so the error text never appeared, in every
 * browser, however empty the field was.
 *
 * This is a real Material render (no `NO_ERRORS_SCHEMA`), because that's
 * exactly the mechanism the bug — and the fix, adding `required` to the
 * builder's textareas (packet-builder.component.html) — lives in.
 * `PacketBuilderComponent` itself pulls in far more of the Material module
 * surface (drag-drop, expansion, menu, autocomplete) than a focused test
 * needs, so this exercises the same `mat-form-field` + `required textarea` +
 * `mat-error` pattern in isolation, extracted verbatim from the builder's
 * template.
 */
@Component({
  template: `
    <mat-form-field appearance="outline">
      <mat-label>Question</mat-label>
      <textarea matInput rows="3" required [maxlength]="200" [(ngModel)]="question"></textarea>
      @if (!question.trim()) {
        <mat-error>Question is required</mat-error>
      }
    </mat-form-field>
  `,
  imports: [FormsModule, MatFormFieldModule, MatInputModule],
})
class RequiredTextareaHostComponent {
  question = 'Some question';
}

describe('packet-builder required-field mat-error (NG-V1-03)', () => {
  let fixture: ComponentFixture<RequiredTextareaHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RequiredTextareaHostComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(RequiredTextareaHostComponent);
  });

  function textarea(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('textarea');
  }

  function errorVisible(): boolean {
    return !!fixture.nativeElement.querySelector('mat-error');
  }

  it('shows no error while filled in and untouched', () => {
    fixture.detectChanges();
    expect(errorVisible()).toBeFalse();
  });

  it('does not show the error merely from being cleared, before the field is touched', () => {
    fixture.detectChanges();
    textarea().value = '';
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // This is the pre-fix behavior for the *value* (empty and untouched);
    // the fix's payoff is the next test, once the field is also touched.
    expect(errorVisible()).toBeFalse();
  });

  it('shows "Question is required" once the field is cleared and touched (the actual NG-V1-03 fix)', () => {
    fixture.detectChanges();
    const el = textarea();
    el.value = '';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('blur')); // marks the NgModel control touched
    fixture.detectChanges();

    expect(errorVisible()).toBeTrue();
    expect(fixture.nativeElement.querySelector('mat-error').textContent).toContain('Question is required');
  });
});
