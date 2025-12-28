import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { Packet } from '../../models/sockbowl/sockbowl-interfaces';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
    selector: 'app-packet-search',
    templateUrl: './packet-search.component.html',
    styleUrls: ['./packet-search.component.scss'],
    standalone: false
})
export class PacketSearchComponent implements OnInit {
  // Search tab properties
  searchQuery: string = "";
  searchResults: Packet[] = [];
  selectedPacketId: String = "";
  isSearching: boolean = false;
  private searchSubject = new Subject<string>();

  // Generate tab properties
  generateTopic: string = "";
  generateContext: string = "";
  questionCount: number = 5;  // Default to 5, max 30
  generateBonuses: boolean = true;  // Default to true
  isGenerating: boolean = false;
  generatedPacket: Packet | null = null;

  // API configuration properties
  apiKey: string = '';
  selectedModel: string = '';
  rememberApiKey: boolean = false;
  availableModels: string[] = [];
  isLoadingModels: boolean = false;
  modelLoadError: string | null = null;
  validationError: string | null = null;
  showApiKey: boolean = false;

  // LLM parameter properties with defaults
  temperature: number = 1.0;
  topP: number = 1.0;
  frequencyPenalty: number = 0.0;
  presencePenalty: number = 0.0;

  // Parameter visibility flags
  supportsTemperature: boolean = true;
  supportsTopP: boolean = true;
  supportsFrequencyPenalty: boolean = true;
  supportsPresencePenalty: boolean = true;

  private readonly STORAGE_KEY = 'openai_api_key';

  // Model parameter support mapping
  private readonly MODEL_PARAMS: { [key: string]: string[] } = {
    // GPT-4 models support all parameters
    'gpt-4': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],
    'gpt-4-turbo': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],
    'gpt-4o': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],
    'gpt-4o-mini': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],

    // GPT-3.5 models support all parameters
    'gpt-3.5-turbo': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],
    'gpt-3.5-turbo-16k': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty'],

    // TTS models typically only support temperature
    'tts': ['temperature'],

    // Default for unknown models - support all
    'default': ['temperature', 'topP', 'frequencyPenalty', 'presencePenalty']
  };

  constructor(
    private dialogRef: MatDialogRef<PacketSearchComponent>,
    private sockbowlQuestionsService: SockbowlQuestionsService,
    private openAiModelService: OpenAiModelService,
    private snackBar: MatSnackBar,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    // Set up debounced search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.performSearch(query);
    });

    // Load saved API key if available
    this.loadSavedApiKey();
  }

  searchPackets(): void {
    this.searchSubject.next(this.searchQuery);
  }

  private performSearch(query: string): void {
    if (query && query.length >= 2) {
      this.isSearching = true;
      this.sockbowlQuestionsService.searchPacketsByName(query).subscribe({
        next: (results) => {
          this.searchResults = results;
          this.isSearching = false;
        },
        error: (error) => {
          console.error('Search error:', error);
          this.searchResults = [];
          this.isSearching = false;
        }
      });
    } else {
      this.searchResults = [];
      this.isSearching = false;
    }
  }

  selectPacket(packet: Packet): void {
    this.selectedPacketId = packet.id;
  }

  generateAIPacket(): void {
    // Validate all required fields
    if (!this.validateGenerationForm()) {
      return;
    }

    // Clear previous validation errors
    this.validationError = null;

    // Save API key if remember is checked
    if (this.rememberApiKey && this.apiKey) {
      localStorage.setItem(this.STORAGE_KEY, this.apiKey);
    }

    this.isGenerating = true;
    this.sockbowlQuestionsService.generatePacket(
      this.generateTopic,
      this.generateContext,
      this.apiKey,
      this.selectedModel,
      this.questionCount,
      this.generateBonuses,
      this.temperature,
      this.topP,
      this.frequencyPenalty,
      this.presencePenalty
    ).subscribe({
      next: (packet) => {
        this.generatedPacket = packet;
        this.isGenerating = false;
        this.snackBar.open('Packet generated successfully!', 'Close', {
          duration: 3000
        });
      },
      error: (error) => {
        console.error('Generation error:', error);
        this.isGenerating = false;

        // Handle different error types
        let errorMessage = 'Error generating packet. Please try again.';
        if (error.status === 400) {
          errorMessage = 'Invalid request. Please check your API key and model selection.';
        } else if (error.status === 401) {
          errorMessage = 'Invalid API key. Please check your OpenAI API key.';
        } else if (error.status === 429) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (error.name === 'TimeoutError') {
          errorMessage = 'Request timed out. The generation may still be processing.';
        }

        this.snackBar.open(errorMessage, 'Close', {
          duration: 5000
        });
      }
    });
  }

  /**
   * Load saved API key from localStorage
   */
  loadSavedApiKey(): void {
    const savedKey = localStorage.getItem(this.STORAGE_KEY);
    if (savedKey) {
      this.apiKey = savedKey;
      this.rememberApiKey = true;
      this.fetchAvailableModels();
    } else {
      // Update parameter visibility even without saved key
      this.updateParameterVisibility();
    }
  }

  /**
   * Fetch available models from OpenAI API
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

        // Auto-select first model if none selected
        if (models.length > 0 && !this.selectedModel) {
          this.selectedModel = models[0];
          this.updateParameterVisibility();
        }
      },
      error: (error) => {
        console.error('Error fetching models:', error);
        this.isLoadingModels = false;
        this.modelLoadError = 'Could not fetch models from OpenAI. Using default list.';
        this.availableModels = this.openAiModelService.getFallbackModels();

        // Auto-select first fallback model
        if (this.availableModels.length > 0 && !this.selectedModel) {
          this.selectedModel = this.availableModels[0];
          this.updateParameterVisibility();
        }

        this.snackBar.open('Could not fetch models from OpenAI. Using default list.', 'Close', {
          duration: 3000
        });
      }
    });
  }

  /**
   * Handle API key input changes
   */
  onApiKeyChange(): void {
    // Clear models when API key changes
    if (!this.apiKey || this.apiKey.trim().length === 0) {
      this.availableModels = [];
      this.selectedModel = '';
      this.modelLoadError = null;
    }
  }

  /**
   * Handle API key field blur event
   */
  onApiKeyBlur(): void {
    // Fetch models when user finishes entering API key
    if (this.apiKey && this.apiKey.trim().length > 0) {
      this.fetchAvailableModels();
    }
  }

  /**
   * Toggle API key visibility
   */
  toggleApiKeyVisibility(): void {
    this.showApiKey = !this.showApiKey;
  }

  /**
   * Handle remember checkbox change
   */
  onRememberChange(): void {
    if (!this.rememberApiKey) {
      // Remove from storage if unchecked
      localStorage.removeItem(this.STORAGE_KEY);
    } else if (this.apiKey) {
      // Save to storage if checked and key exists
      localStorage.setItem(this.STORAGE_KEY, this.apiKey);
    }
  }

  /**
   * Update parameter visibility based on selected model
   */
  updateParameterVisibility(): void {
    if (!this.selectedModel) {
      // Default to all visible if no model selected
      this.supportsTemperature = true;
      this.supportsTopP = true;
      this.supportsFrequencyPenalty = true;
      this.supportsPresencePenalty = true;
      return;
    }

    // Find the matching model key (check if model name contains any key)
    let supportedParams: string[] = this.MODEL_PARAMS['default'];

    for (const [key, params] of Object.entries(this.MODEL_PARAMS)) {
      if (this.selectedModel.toLowerCase().includes(key.toLowerCase())) {
        supportedParams = params;
        break;
      }
    }

    // Update visibility flags
    this.supportsTemperature = supportedParams.includes('temperature');
    this.supportsTopP = supportedParams.includes('topP');
    this.supportsFrequencyPenalty = supportedParams.includes('frequencyPenalty');
    this.supportsPresencePenalty = supportedParams.includes('presencePenalty');

    // Reset unsupported parameters to defaults
    if (!this.supportsTemperature) this.temperature = 1.0;
    if (!this.supportsTopP) this.topP = 1.0;
    if (!this.supportsFrequencyPenalty) this.frequencyPenalty = 0.0;
    if (!this.supportsPresencePenalty) this.presencePenalty = 0.0;
  }

  /**
   * Validate generation form
   */
  validateGenerationForm(): boolean {
    this.validationError = null;

    if (!this.generateTopic || this.generateTopic.trim().length === 0) {
      this.validationError = 'Topic is required';
      this.snackBar.open('Topic is required', 'Close', { duration: 3000 });
      return false;
    }

    if (!this.apiKey || this.apiKey.trim().length === 0) {
      this.validationError = 'API key is required';
      this.snackBar.open('API key is required', 'Close', { duration: 3000 });
      return false;
    }

    if (!this.selectedModel || this.selectedModel.trim().length === 0) {
      this.validationError = 'Model selection is required';
      this.snackBar.open('Model selection is required', 'Close', { duration: 3000 });
      return false;
    }

    // Validate question count
    if (this.questionCount < 1) {
      this.validationError = 'Question count must be at least 1';
      this.snackBar.open('Question count must be at least 1', 'Close', { duration: 3000 });
      return false;
    }

    if (this.questionCount > 30) {
      this.validationError = 'Question count cannot exceed 30';
      this.snackBar.open('Question count cannot exceed 30', 'Close', { duration: 3000 });
      return false;
    }

    return true;
  }

  confirmSelection(): void {
    // Prioritize generated packet if it exists
    if (this.generatedPacket) {
      this.dialogRef.close(this.generatedPacket);
      return;
    }

    // Otherwise use selected packet from search
    const selectedPacket = this.searchResults.find(p => p.id === this.selectedPacketId);
    if (selectedPacket) {
      this.dialogRef.close(selectedPacket);
    }
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.searchResults = [];
    this.selectedPacketId = "";
  }

  close(): void {
    this.dialogRef.close();
  }
}
