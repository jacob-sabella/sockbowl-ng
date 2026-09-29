import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Subject, of, throwError } from 'rxjs';

import { SavedAiKeyCardComponent } from './saved-ai-key-card.component';
import { DEFAULT_CLAUDE_MODELS, SavedAiKeyService, SavedAiKeyStatus } from '../../../../shared/ai-key/saved-ai-key.service';
import { ConfirmDialogService } from '../../../../shared/confirm-dialog/confirm-dialog.service';

describe('SavedAiKeyCardComponent', () => {
  let fixture: ComponentFixture<SavedAiKeyCardComponent>;
  let component: SavedAiKeyCardComponent;
  let service: jasmine.SpyObj<SavedAiKeyService>;
  let confirmDialog: jasmine.SpyObj<ConfirmDialogService>;

  const NOT_CONFIGURED: SavedAiKeyStatus = {
    configured: false, provider: 'anthropic', model: null, last4: null, updatedAt: null,
  };
  const CONFIGURED: SavedAiKeyStatus = {
    configured: true, provider: 'anthropic', model: 'claude-sonnet-5', last4: 'AbCd', updatedAt: '2026-09-28T12:00:00Z',
  };

  function setUp(
    status: ReturnType<SavedAiKeyService['refresh']>,
    models: ReturnType<SavedAiKeyService['listModels']> = of(['claude-sonnet-5', 'claude-opus-5-5'])
  ): void {
    service = jasmine.createSpyObj<SavedAiKeyService>('SavedAiKeyService',
      ['refresh', 'save', 'updateModel', 'remove', 'listModels']);
    service.refresh.and.returnValue(status);
    service.listModels.and.returnValue(models);
    confirmDialog = jasmine.createSpyObj<ConfirmDialogService>('ConfirmDialogService', ['confirm']);

    TestBed.configureTestingModule({
      declarations: [SavedAiKeyCardComponent],
      imports: [FormsModule, MatInputModule, MatSelectModule],
      providers: [
        { provide: SavedAiKeyService, useValue: service },
        { provide: ConfirmDialogService, useValue: confirmDialog },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(SavedAiKeyCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows a loading state until the status resolves', () => {
    setUp(new Subject<SavedAiKeyStatus>());

    expect(component.state).toBe('loading');
    expect(text()).toContain('Loading');
  });

  it('503: says saved keys are off and hides the form', () => {
    setUp(throwError(() => new HttpErrorResponse({ status: 503 })));

    expect(text()).toContain("Saved keys aren't enabled on this server");
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).toBeNull();
  });

  it('not configured: shows the key form with the default models, defaulting to claude-sonnet-5', () => {
    setUp(of(NOT_CONFIGURED));

    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector<HTMLInputElement>('input[name="apiKey"]');
    expect(input?.type).toBe('password');
    expect(input?.getAttribute('placeholder')).toBe('sk-ant-…');
    expect(component.formModel).toBe('claude-sonnet-5');
    expect(component.defaultModels).toEqual(DEFAULT_CLAUDE_MODELS);
    expect(el.querySelector('a[href="https://console.anthropic.com/settings/keys"]')).not.toBeNull();
  });

  it('saves the key, clears the input, and switches to the configured view', () => {
    setUp(of(NOT_CONFIGURED));
    service.save.and.returnValue(of(CONFIGURED));

    component.apiKeyInput = '  sk-ant-secret  ';
    component.save();
    fixture.detectChanges();

    expect(service.save).toHaveBeenCalledWith('sk-ant-secret', 'claude-sonnet-5');
    expect(component.apiKeyInput).toBe('');
    expect(service.listModels).toHaveBeenCalled();
    expect(text()).toContain('Saved key ••••AbCd');
  });

  it('shows the server\'s message when the key is rejected, keeping the form', () => {
    setUp(of(NOT_CONFIGURED));
    service.save.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: 'Invalid API key' })));

    component.apiKeyInput = 'sk-ant-bad';
    component.save();
    fixture.detectChanges();

    expect(component.saving).toBeFalse();
    expect(text()).toContain('Invalid API key');
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
  });

  it('configured: lists the key\'s models and PATCHes a model change', () => {
    setUp(of(CONFIGURED));
    service.updateModel.and.returnValue(of({ ...CONFIGURED, model: 'claude-opus-5-5' }));

    expect(component.models).toEqual(['claude-sonnet-5', 'claude-opus-5-5']);
    component.onModelChange('claude-opus-5-5');

    expect(service.updateModel).toHaveBeenCalledWith('claude-opus-5-5');
    expect(component.status?.model).toBe('claude-opus-5-5');
  });

  it('falls back to the default models when /models fails', () => {
    setUp(of(CONFIGURED), throwError(() => new HttpErrorResponse({ status: 404 })));

    expect(component.models).toEqual([...DEFAULT_CLAUDE_MODELS]);
  });

  it('reverts the model select when the PATCH fails', () => {
    setUp(of(CONFIGURED));
    service.updateModel.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: 'Unknown model' })));

    component.onModelChange('claude-opus-5-5');

    expect(component.status?.model).toBe('claude-sonnet-5');
    expect(component.modelError).toBe('Unknown model');
  });

  it('Replace key shows the form again; Remove deletes after confirming', () => {
    setUp(of(CONFIGURED));

    component.startReplace();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
    component.cancelReplace();

    confirmDialog.confirm.and.returnValue(of(true));
    service.remove.and.returnValue(of(undefined));
    component.remove();
    fixture.detectChanges();

    expect(service.remove).toHaveBeenCalled();
    expect(component.status?.configured).toBeFalse();
    expect((fixture.nativeElement as HTMLElement).querySelector('form')).not.toBeNull();
  });

  it('does not remove when the confirmation is cancelled', () => {
    setUp(of(CONFIGURED));
    confirmDialog.confirm.and.returnValue(of(false));

    component.remove();

    expect(service.remove).not.toHaveBeenCalled();
  });
});
