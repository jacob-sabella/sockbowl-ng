import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { AiKeyPickerComponent } from './ai-key-picker.component';
import { AiKeyService } from './ai-key.service';
import { OpenAiModelService } from '../../game/services/openai-model.service';

describe('AiKeyPickerComponent', () => {
  let component: AiKeyPickerComponent;
  let fixture: ComponentFixture<AiKeyPickerComponent>;
  let aiKeyService: jasmine.SpyObj<AiKeyService>;
  let openAiModelService: jasmine.SpyObj<OpenAiModelService>;

  function configure(savedKey: string | null = null): void {
    aiKeyService = jasmine.createSpyObj<AiKeyService>('AiKeyService', ['loadKey', 'saveKey', 'forgetKey']);
    aiKeyService.loadKey.and.returnValue(savedKey);
    openAiModelService = jasmine.createSpyObj<OpenAiModelService>('OpenAiModelService', ['fetchModels', 'getFallbackModels']);
    openAiModelService.fetchModels.and.returnValue(of(['gpt-4o', 'gpt-4o-mini']));
    openAiModelService.getFallbackModels.and.returnValue(['gpt-3.5-turbo']);

    TestBed.configureTestingModule({
      declarations: [AiKeyPickerComponent],
      providers: [
        { provide: AiKeyService, useValue: aiKeyService },
        { provide: OpenAiModelService, useValue: openAiModelService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AiKeyPickerComponent);
    component = fixture.componentInstance;
  }

  it('loads a remembered key on init and fetches its models', () => {
    configure('sk-saved');
    const apiKeyChanges: string[] = [];
    component.apiKeyChange.subscribe((v) => apiKeyChanges.push(v));

    fixture.detectChanges();

    expect(apiKeyChanges).toEqual(['sk-saved']);
    expect(openAiModelService.fetchModels).toHaveBeenCalledWith('sk-saved');
    expect(component.availableModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  it('does not touch storage when an apiKey input is already provided', () => {
    configure('sk-saved');
    component.apiKey = 'sk-from-parent';

    fixture.detectChanges();

    expect(aiKeyService.loadKey).not.toHaveBeenCalled();
  });

  it('remembers the key as the user types, honoring the remember toggle', () => {
    configure(null);
    fixture.detectChanges();

    component.onApiKeyChange('sk-new');

    expect(aiKeyService.saveKey).toHaveBeenCalledWith('sk-new', true);

    component.onRememberChange(false);
    component.onApiKeyChange('sk-new-2');

    expect(aiKeyService.saveKey).toHaveBeenCalledWith('sk-new-2', false);
  });

  it('clearing the key clears the model list and the selection', () => {
    configure(null);
    fixture.detectChanges();
    component.onApiKeyChange('sk-new');
    component.onModelChange('gpt-4o');

    component.onApiKeyChange('');

    expect(component.availableModels).toEqual([]);
    expect(component.model).toBe('');
  });

  it('falls back to the default model list when the fetch errors', () => {
    configure(null);
    openAiModelService.fetchModels.and.returnValue(throwError(() => new Error('network down')));
    fixture.detectChanges();

    component.onApiKeyChange('sk-new');
    component.fetchAvailableModels();

    expect(component.availableModels).toEqual(['gpt-3.5-turbo']);
    expect(component.modelLoadError).toContain('Could not fetch models');
    expect(component.model).toBe('gpt-3.5-turbo');
  });

  it('auto-selects the first model once fetched, if none is already set', () => {
    configure(null);
    const modelChanges: string[] = [];
    fixture.detectChanges();
    component.modelChange.subscribe((v) => modelChanges.push(v));

    component.onApiKeyChange('sk-new');
    component.onApiKeyBlur();

    expect(modelChanges).toEqual(['gpt-4o']);
  });

  it('toggles API key visibility', () => {
    configure(null);
    fixture.detectChanges();

    expect(component.showApiKey).toBeFalse();
    component.toggleApiKeyVisibility();
    expect(component.showApiKey).toBeTrue();
  });
});
