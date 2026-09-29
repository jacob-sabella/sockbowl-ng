import { Component, ChangeDetectionStrategy, OnInit, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_MODELS,
  SavedAiKeyService,
  SavedAiKeyStatus,
  describeSavedAiKeyError
} from '../../../../shared/ai-key/saved-ai-key.service';
import { ConfirmDialogService } from '../../../../shared/confirm-dialog/confirm-dialog.service';

/**
 * The profile page's "Claude API key" card: save a Claude (Anthropic) key on
 * the server so AI generation can use it without pasting one each time.
 * The key only lives in {@link apiKeyInput} until the PUT succeeds, then is
 * cleared; it is never written to browser storage. The profile only renders
 * this for users with `question:generate`, the permission every
 * `/api/me/ai-key` endpoint requires.
 */
@Component({
  selector: 'app-saved-ai-key-card',
  templateUrl: './saved-ai-key-card.component.html',
  styleUrls: ['./saved-ai-key-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class SavedAiKeyCardComponent implements OnInit {
  private savedAiKeyService = inject(SavedAiKeyService);
  private confirmDialog = inject(ConfirmDialogService);

  readonly consoleUrl = 'https://console.anthropic.com/settings/keys';

  /** `disabled`: the server answered 503 (saved keys turned off there). */
  state: 'loading' | 'ready' | 'disabled' | 'error' = 'loading';
  loadError: string | null = null;
  status: SavedAiKeyStatus | null = null;

  /** The save form shows when no key is saved, or while replacing one. */
  replacing = false;
  apiKeyInput = '';
  showApiKey = false;
  formModel = DEFAULT_CLAUDE_MODEL;
  saving = false;
  formError: string | null = null;

  /** Model choices for the saved key: its `/models` list, or the defaults if that fails. */
  models: string[] = [...DEFAULT_CLAUDE_MODELS];
  updatingModel = false;
  modelError: string | null = null;
  removing = false;

  readonly defaultModels = DEFAULT_CLAUDE_MODELS;

  get showForm(): boolean {
    return !!this.status && (!this.status.configured || this.replacing);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.state = 'loading';
    this.loadError = null;
    this.savedAiKeyService.refresh().subscribe({
      next: (status) => {
        this.status = status;
        this.state = 'ready';
        if (status.configured) {
          this.loadModels();
        }
      },
      error: (err) => {
        if (err instanceof HttpErrorResponse && err.status === 503) {
          this.state = 'disabled';
          return;
        }
        this.loadError = describeSavedAiKeyError(err);
        this.state = 'error';
      }
    });
  }

  save(): void {
    const apiKey = this.apiKeyInput.trim();
    if (!apiKey || this.saving) {
      return;
    }
    this.saving = true;
    this.formError = null;
    this.savedAiKeyService.save(apiKey, this.formModel).subscribe({
      next: (status) => {
        this.apiKeyInput = '';
        this.showApiKey = false;
        this.saving = false;
        this.replacing = false;
        this.status = status;
        this.loadModels();
      },
      error: (err) => {
        this.saving = false;
        this.formError = describeSavedAiKeyError(err);
      }
    });
  }

  startReplace(): void {
    this.replacing = true;
    this.apiKeyInput = '';
    this.formError = null;
    this.formModel = this.status?.model || DEFAULT_CLAUDE_MODEL;
  }

  cancelReplace(): void {
    this.replacing = false;
    this.apiKeyInput = '';
    this.formError = null;
  }

  /** PATCHes the saved model; on failure the select snaps back to the saved one. */
  onModelChange(model: string): void {
    if (!this.status || model === this.status.model) {
      return;
    }
    const previous = this.status;
    this.status = { ...previous, model };
    this.updatingModel = true;
    this.modelError = null;
    this.savedAiKeyService.updateModel(model).subscribe({
      next: (status) => {
        this.status = status;
        this.updatingModel = false;
      },
      error: (err) => {
        this.status = previous;
        this.updatingModel = false;
        this.modelError = describeSavedAiKeyError(err);
      }
    });
  }

  remove(): void {
    this.confirmDialog.confirm({
      title: 'Remove your saved Claude key?',
      message: 'AI generation will ask for an API key again until you save a new one.',
      confirmText: 'Remove',
      destructive: true
    }).subscribe(confirmed => {
      if (!confirmed) {
        return;
      }
      this.removing = true;
      this.modelError = null;
      this.savedAiKeyService.remove().subscribe({
        next: () => {
          this.removing = false;
          this.replacing = false;
          this.status = { configured: false, provider: 'anthropic', model: null, last4: null, updatedAt: null };
          this.formModel = DEFAULT_CLAUDE_MODEL;
          this.models = [...DEFAULT_CLAUDE_MODELS];
        },
        error: (err) => {
          this.removing = false;
          this.modelError = describeSavedAiKeyError(err);
        }
      });
    });
  }

  toggleApiKeyVisibility(): void {
    this.showApiKey = !this.showApiKey;
  }

  private loadModels(): void {
    this.savedAiKeyService.listModels().subscribe({
      next: (models) => this.models = this.withSavedModel(models.length > 0 ? models : [...DEFAULT_CLAUDE_MODELS]),
      error: () => this.models = this.withSavedModel([...DEFAULT_CLAUDE_MODELS])
    });
  }

  /** Keeps the saved model selectable even if the list doesn't include it. */
  private withSavedModel(models: string[]): string[] {
    const saved = this.status?.model;
    return saved && !models.includes(saved) ? [saved, ...models] : models;
  }
}
