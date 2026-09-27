import { Component, ChangeDetectionStrategy, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { AiKeyService } from './ai-key.service';
import { OpenAiModelService } from '../../game/services/openai-model.service';

/**
 * Shared OpenAI API-key + model picker (PB-08). Owns the key field (with
 * remember-key persistence via {@link AiKeyService}), the model dropdown and
 * the {@link OpenAiModelService} fetch/fallback logic that `packet-search`
 * used to inline (M3 plan 3.3.1/3.3.5). `packet-search` embeds it in its
 * "Generate with AI" tab, and N3 embeds it in the builder's AI-assist form,
 * so both send the user's key and model (PB-08's other half).
 */
@Component({
  selector: 'app-ai-key-picker',
  templateUrl: './ai-key-picker.component.html',
  styleUrls: ['./ai-key-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class AiKeyPickerComponent implements OnInit {
  private aiKeyService = inject(AiKeyService);
  private openAiModelService = inject(OpenAiModelService);

  @Input() apiKey = '';
  @Input() model = '';
  @Output() apiKeyChange = new EventEmitter<string>();
  @Output() modelChange = new EventEmitter<string>();

  rememberKey = true;
  showApiKey = false;
  availableModels: string[] = [];
  isLoadingModels = false;
  modelLoadError: string | null = null;

  ngOnInit(): void {
    if (!this.apiKey) {
      const saved = this.aiKeyService.loadKey();
      if (saved) {
        this.apiKey = saved;
        this.apiKeyChange.emit(saved);
      }
    }
    if (this.apiKey) {
      this.fetchAvailableModels();
    }
  }

  onApiKeyChange(value: string): void {
    this.apiKey = value;
    this.apiKeyChange.emit(value);
    this.aiKeyService.saveKey(value, this.rememberKey);

    // A cleared key invalidates whatever model list was fetched for the old one.
    if (!value || value.trim().length === 0) {
      this.availableModels = [];
      this.modelLoadError = null;
      if (this.model) {
        this.onModelChange('');
      }
    }
  }

  /** Fetch models once the user finishes entering the key (matches the old inline behavior). */
  onApiKeyBlur(): void {
    if (this.apiKey && this.apiKey.trim().length > 0) {
      this.fetchAvailableModels();
    }
  }

  onRememberChange(remember: boolean): void {
    this.rememberKey = remember;
    this.aiKeyService.saveKey(this.apiKey, remember);
  }

  onModelChange(value: string): void {
    this.model = value;
    this.modelChange.emit(value);
  }

  /**
   * Fetch available models from OpenAI for the current key. Exposed so the
   * template's "Fetch Models" fallback button can retry.
   */
  fetchAvailableModels(): void {
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      this.modelLoadError = 'API key is required to fetch models';
      this.availableModels = this.openAiModelService.getFallbackModels();
      return;
    }

    this.isLoadingModels = true;
    this.modelLoadError = null;

    this.openAiModelService.fetchModels(this.apiKey).subscribe({
      next: (models) => {
        this.availableModels = models;
        this.isLoadingModels = false;

        if (models.length > 0 && !this.model) {
          this.onModelChange(models[0]);
        }
      },
      error: (error) => {
        console.error('Error fetching models:', error);
        this.isLoadingModels = false;
        this.modelLoadError = 'Could not fetch models from OpenAI. Using default list.';
        this.availableModels = this.openAiModelService.getFallbackModels();

        if (this.availableModels.length > 0 && !this.model) {
          this.onModelChange(this.availableModels[0]);
        }
      }
    });
  }

  toggleApiKeyVisibility(): void {
    this.showApiKey = !this.showApiKey;
  }
}
