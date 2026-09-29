import { Component, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { take } from 'rxjs/operators';
import { AiKeyService } from './ai-key.service';
import { SavedAiKeyService, SavedAiKeyStatus } from './saved-ai-key.service';
import { OpenAiModelService } from '../../game/services/openai-model.service';

/**
 * Shared OpenAI API-key + model picker (PB-08). Owns the key field (with
 * remember-key persistence via {@link AiKeyService}), the model dropdown and
 * the {@link OpenAiModelService} fetch/fallback logic that `packet-search`
 * used to inline (M3 plan 3.3.1/3.3.5). `packet-search` embeds it in its
 * "Generate with AI" tab, and N3 embeds it in the builder's AI-assist form,
 * so both send the user's key and model (PB-08's other half).
 *
 * If the user has a Claude key saved on their profile ({@link SavedAiKeyService}),
 * the picker starts in saved-key mode instead: a one-line notice, an empty
 * `apiKey`/`model` pair (so the host sends no `X-API-Key`/`X-Model` and the
 * server uses the saved key and model), and `(useSavedKeyChange)` true so the
 * host can relax its "key required" validation. "Use a different key for this
 * request" drops back to the fields above for that one request.
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
  private savedAiKeyService = inject(SavedAiKeyService);
  private cdr = inject(ChangeDetectorRef);
  private destroyRef = inject(DestroyRef);

  @Input() apiKey = '';
  @Input() model = '';
  @Output() apiKeyChange = new EventEmitter<string>();
  @Output() modelChange = new EventEmitter<string>();
  /** True while generation should use the profile's saved key (apiKey/model are emitted empty). */
  @Output() useSavedKeyChange = new EventEmitter<boolean>();

  rememberKey = true;
  showApiKey = false;
  availableModels: string[] = [];
  isLoadingModels = false;
  modelLoadError: string | null = null;

  /** False until the saved-key status has been read (either way). */
  savedKeyChecked = false;
  /** The profile's saved key, when one is configured. */
  savedKey: SavedAiKeyStatus | null = null;
  useSavedKey = false;

  ngOnInit(): void {
    this.savedAiKeyService.status$.pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(status => {
      this.savedKeyChecked = true;
      if (status.configured) {
        this.savedKey = status;
        this.useSavedKeyMode();
      } else {
        this.initPastedKey();
      }
      this.cdr.markForCheck();
    });
  }

  /** "Use a different key for this request": back to the paste-a-key fields. */
  useDifferentKey(): void {
    this.useSavedKey = false;
    this.useSavedKeyChange.emit(false);
    this.initPastedKey();
  }

  /**
   * Saved-key mode: clear the pasted key/model the host would send (without
   * touching the remembered OpenAI key in storage) so the server falls back
   * to the saved key and its saved model.
   */
  useSavedKeyMode(): void {
    this.useSavedKey = true;
    this.apiKey = '';
    this.model = '';
    this.availableModels = [];
    this.modelLoadError = null;
    this.apiKeyChange.emit('');
    this.modelChange.emit('');
    this.useSavedKeyChange.emit(true);
  }

  /** The original paste-a-key start-up: seed a remembered key and fetch its models. */
  private initPastedKey(): void {
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
        // Switched back to the saved key while this was in flight: nothing to pick.
        if (this.useSavedKey) {
          this.isLoadingModels = false;
          return;
        }
        this.availableModels = models;
        this.isLoadingModels = false;
        this.cdr.markForCheck();

        if (models.length > 0 && !this.model) {
          this.onModelChange(models[0]);
        }
      },
      error: (error) => {
        console.error('Error fetching models:', error);
        this.isLoadingModels = false;
        if (this.useSavedKey) {
          return;
        }
        this.modelLoadError = 'Could not fetch models from OpenAI. Using default list.';
        this.availableModels = this.openAiModelService.getFallbackModels();
        this.cdr.markForCheck();

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
