import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { Packet } from '../../models/sockbowl/packet-types.generated';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AuthService } from '../../../core/auth/auth.service';

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

  // qbreader tab properties
  qbMode: 'set' | 'random' = 'set';
  qbSets: string[] = [];
  qbFilteredSets: string[] = [];
  qbSelectedSet: string = '';
  qbPacketNumber: number = 1;
  qbPacketCount: number | null = null;
  qbLoadingSets: boolean = false;
  qbImporting: boolean = false;
  qbLoaded: boolean = false;

  // The 12 canonical qbreader categories. ("Pop Culture" is qbreader's name for
  // what quizbowl traditionally calls "Trash" — the earlier 'Trash' label was
  // silently ignored by the API and returned unfiltered questions.)
  readonly qbCategories: string[] = [
    'Literature', 'History', 'Science', 'Fine Arts', 'Religion', 'Mythology',
    'Philosophy', 'Social Science', 'Geography', 'Current Events', 'Other Academic', 'Pop Culture'
  ];
  // qbreader's subcategory taxonomy (from quizbowl/categories.js). Only these
  // categories break into multiple distinct subcategories; the rest (Religion,
  // Mythology, Philosophy, Social Science, Current Events, Geography, Other
  // Academic) are leaf categories whose only subcategory equals the category, so
  // filtering them by subcategory is redundant with the category chip. NOTE: Math,
  // Astronomy, etc. are qbreader ALTERNATE subcategories, a separate dimension —
  // not listed here.
  readonly qbSubcategoriesByCategory: { [category: string]: string[] } = {
    'Literature': ['American Literature', 'British Literature', 'Classical Literature',
                   'European Literature', 'World Literature', 'Other Literature'],
    'History': ['American History', 'Ancient History', 'European History',
                'World History', 'Other History'],
    'Science': ['Biology', 'Chemistry', 'Physics', 'Other Science'],
    'Fine Arts': ['Visual Fine Arts', 'Auditory Fine Arts', 'Other Fine Arts'],
    'Pop Culture': ['Movies', 'Music', 'Sports', 'Television', 'Video Games', 'Other Pop Culture']
  };
  readonly qbDifficultyTiers: { label: string; values: number[] }[] = [
    { label: 'Middle School', values: [1, 2] },
    { label: 'Easy HS', values: [3, 4] },
    { label: 'Regular HS', values: [5] },
    { label: 'Hard HS', values: [6] },
    { label: 'College', values: [7, 8] },
    { label: 'Open', values: [9, 10] }
  ];
  qbSelectedCategories: string[] = [];
  qbSelectedTiers: string[] = ['Regular HS'];
  qbTossupCount: number = 20;
  qbBonusCount: number = 20;
  qbRandomName: string = '';

  // Advanced qbreader filters (all optional).
  qbShowAdvanced: boolean = false;
  readonly qbAllDifficulties: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  qbIndividualDifficulties: number[] = []; // if any selected, overrides the coarse tiers
  qbSelectedSubcategories: string[] = [];  // picked from the taxonomy above
  qbMinYear: number | null = null;
  qbMaxYear: number | null = null;
  qbStandardOnly: boolean = false;
  // De-dupe against questions this account has already seen (logged-in only).
  qbAvoidRepeats: boolean = true;

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
    public auth: AuthService,
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

  /* ------------------------------- qbreader ------------------------------- */

  /** Lazily load the set list the first time the qbreader tab is opened. */
  onTabChange(index: number): void {
    // The qbreader tab is the third tab (index 2).
    if (index === 2 && !this.qbLoaded) {
      this.loadQbSets();
    }
  }

  private loadQbSets(): void {
    this.qbLoaded = true;
    this.qbLoadingSets = true;
    this.sockbowlQuestionsService.getQbreaderSets().subscribe({
      next: (sets) => {
        this.qbSets = sets;
        this.qbFilteredSets = sets.slice(0, 60);
        this.qbLoadingSets = false;
      },
      error: () => {
        this.qbLoadingSets = false;
        this.qbLoaded = false;
        this.snackBar.open('Could not reach qbreader. Try again.', 'Close', { duration: 4000 });
      }
    });
  }

  filterQbSets(query: string): void {
    const q = (query || '').toLowerCase().trim();
    this.qbFilteredSets = (q
      ? this.qbSets.filter(s => s.toLowerCase().includes(q))
      : this.qbSets
    ).slice(0, 60);
  }

  onQbSetSelected(setName: string): void {
    this.qbSelectedSet = setName;
    this.qbPacketNumber = 1;
    this.qbPacketCount = null;
    this.sockbowlQuestionsService.getQbreaderPacketCount(setName).subscribe({
      next: (count) => (this.qbPacketCount = count),
      error: () => (this.qbPacketCount = null)
    });
  }

  toggleQbCategory(category: string): void {
    const i = this.qbSelectedCategories.indexOf(category);
    if (i >= 0) this.qbSelectedCategories.splice(i, 1);
    else this.qbSelectedCategories.push(category);
    // Drop any picked subcategories that no longer belong to the selected categories.
    const available = this.qbAvailableSubcategories;
    this.qbSelectedSubcategories = this.qbSelectedSubcategories.filter(s => available.includes(s));
  }

  /** Subcategories offered: those of the picked categories, or all of them if none picked. */
  get qbAvailableSubcategories(): string[] {
    const map = this.qbSubcategoriesByCategory;
    if (this.qbSelectedCategories.length) {
      return this.qbSelectedCategories.reduce<string[]>((acc, c) => acc.concat(map[c] || []), []);
    }
    return Object.keys(map).reduce<string[]>((acc, c) => acc.concat(map[c]), []);
  }

  toggleQbSubcategory(sub: string): void {
    const i = this.qbSelectedSubcategories.indexOf(sub);
    if (i >= 0) this.qbSelectedSubcategories.splice(i, 1);
    else this.qbSelectedSubcategories.push(sub);
  }

  toggleQbTier(label: string): void {
    const i = this.qbSelectedTiers.indexOf(label);
    if (i >= 0) this.qbSelectedTiers.splice(i, 1);
    else this.qbSelectedTiers.push(label);
  }

  importQbSet(): void {
    if (!this.qbSelectedSet || this.qbImporting) return;
    const number = Math.max(1, Math.min(this.qbPacketNumber || 1, this.qbPacketCount || 999));
    this.qbImporting = true;
    this.sockbowlQuestionsService.importQbreaderPacket(this.qbSelectedSet, number).subscribe({
      next: (res) => this.useImportedPacket(res.id),
      error: (err) => this.onQbImportError(err)
    });
  }

  toggleIndividualDifficulty(d: number): void {
    const i = this.qbIndividualDifficulties.indexOf(d);
    if (i >= 0) this.qbIndividualDifficulties.splice(i, 1);
    else this.qbIndividualDifficulties.push(d);
  }

  /** Whether the account-level de-dup is actually usable (opted in + logged in). */
  get qbDedupActive(): boolean {
    return this.qbAvoidRepeats && this.auth.isAuthenticated();
  }

  private buildRandomBody(excludeRemoteIds?: string[]) {
    // Individual difficulties (if any) take precedence over the coarse tiers.
    const difficulties = this.qbIndividualDifficulties.length
      ? [...this.qbIndividualDifficulties].sort((a, b) => a - b)
      : this.qbDifficultyTiers
          .filter(t => this.qbSelectedTiers.includes(t.label))
          .flatMap(t => t.values);
    return {
      categories: this.qbSelectedCategories,
      subcategories: this.qbSelectedSubcategories.length ? this.qbSelectedSubcategories : undefined,
      difficulties,
      minYear: this.qbMinYear ?? undefined,
      maxYear: this.qbMaxYear ?? undefined,
      standardOnly: this.qbStandardOnly || undefined,
      tossupCount: this.qbTossupCount,
      bonusCount: this.qbBonusCount,
      name: this.qbRandomName?.trim() || undefined,
      excludeRemoteIds
    };
  }

  importQbRandom(): void {
    if (this.qbImporting) return;
    this.qbImporting = true;

    const run = (excludeRemoteIds?: string[]) => {
      this.sockbowlQuestionsService.importQbreaderRandom(this.buildRandomBody(excludeRemoteIds)).subscribe({
        next: (res) => this.afterRandomImport(res),
        error: (err) => this.onQbImportError(err)
      });
    };

    if (this.qbDedupActive) {
      // Best-effort: fetch this account's seen ids to exclude; never block the import on it.
      this.sockbowlQuestionsService.getUsedQuestionIds().subscribe({
        next: (ids) => run(ids),
        error: () => run()
      });
    } else {
      run();
    }
  }

  private afterRandomImport(res: { id: string; usedRemoteIds?: string[] }): void {
    // Record what this account was served, so future generations avoid it. Fire-and-forget.
    if (this.qbDedupActive && res.usedRemoteIds && res.usedRemoteIds.length) {
      this.sockbowlQuestionsService.recordUsedQuestionIds(res.usedRemoteIds).subscribe({ error: () => {} });
    }
    this.useImportedPacket(res.id);
  }

  /** Fetch the full imported packet and hand it back to the config screen. */
  private useImportedPacket(id: string): void {
    this.sockbowlQuestionsService.getPacketById(id).subscribe({
      next: (packet) => {
        this.qbImporting = false;
        if (packet) {
          this.snackBar.open('Packet imported.', 'OK', { duration: 2500 });
          this.dialogRef.close(packet);
        } else {
          this.onQbImportError(null);
        }
      },
      error: (err) => this.onQbImportError(err)
    });
  }

  private onQbImportError(err: any): void {
    this.qbImporting = false;
    console.error('qbreader import error:', err);
    this.snackBar.open('Import failed — try a different set or packet.', 'Close', { duration: 5000 });
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
