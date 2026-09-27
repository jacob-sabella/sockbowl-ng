import { Component, ChangeDetectionStrategy, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { AiKeyService } from './ai-key.service';

/**
 * Shared OpenAI API-key + model picker (PB-08). This is a compiling stub
 * (M3 plan 3.3.1): it remembers/forgets the key through {@link AiKeyService}
 * but doesn't yet fetch the model list. N5 moves the rest of
 * `packet-search.component.ts`'s picker markup (model dropdown,
 * `OpenAiModelService.fetchModels`, load errors) here, and N3 embeds this
 * component in the builder's AI-assist form so it sends the user's key and
 * model (PB-08's other half).
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

  @Input() apiKey = '';
  @Input() model = '';
  @Output() apiKeyChange = new EventEmitter<string>();
  @Output() modelChange = new EventEmitter<string>();

  rememberKey = true;

  ngOnInit(): void {
    if (!this.apiKey) {
      const saved = this.aiKeyService.loadKey();
      if (saved) {
        this.apiKey = saved;
        this.apiKeyChange.emit(saved);
      }
    }
  }

  onApiKeyChange(value: string): void {
    this.apiKey = value;
    this.apiKeyChange.emit(value);
    this.aiKeyService.saveKey(value, this.rememberKey);
  }

  onRememberChange(remember: boolean): void {
    this.rememberKey = remember;
    this.aiKeyService.saveKey(this.apiKey, remember);
  }

  onModelChange(value: string): void {
    this.model = value;
    this.modelChange.emit(value);
  }
}
