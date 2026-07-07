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

  // Generate-tab state
  qbImporting: boolean = false;

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
  // qbreader's ALTERNATE subcategories — a finer, separate filter dimension.
  readonly qbAlternateByCategory: { [category: string]: string[] } = {
    'Literature': ['Drama', 'Long Fiction', 'Poetry', 'Short Fiction', 'Misc Literature'],
    'Science': ['Math', 'Astronomy', 'Computer Science', 'Earth Science', 'Engineering', 'Misc Science'],
    'Fine Arts': ['Architecture', 'Dance', 'Film', 'Jazz', 'Musicals', 'Opera', 'Photography', 'Misc Arts'],
    'Social Science': ['Anthropology', 'Economics', 'Linguistics', 'Psychology', 'Sociology', 'Other Social Science']
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
  qbSelectedAlternateSubcategories: string[] = [];
  // Ranked options shown in each typeahead's autocomplete panel.
  subFiltered: string[] = [];
  altFiltered: string[] = [];
  qbMinYear: number | null = null;
  qbMaxYear: number | null = null;
  qbStandardOnly: boolean = false;
  // Spread the mix across categories instead of a pure random draw.
  qbBalanced: boolean = false;
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

    // Live "how many match" preview for the Generate tab (debounced).
    this.countSubject.pipe(debounceTime(350)).subscribe(() => this.refreshAvailability());
    this.loadFilters();
    this.queueCount();
    this.sockbowlQuestionsService.getBankTaxonomyCounts().subscribe({
      next: (t) => {
        this.categoryCounts = t?.categories || {};
        this.subCounts = t?.subcategories || {};
        this.altCounts = t?.alternates || {};
      },
      error: () => { /* non-critical — chips/options just omit counts */ }
    });
  }

  searchPackets(): void {
    this.searchSubject.next(this.searchQuery);
  }

  /* ----------------------- Generate breadth preview ---------------------- */

  private countSubject = new Subject<void>();
  availTossups: number | null = null;
  availBonuses: number | null = null;
  countingAvail = false;
  categoryCounts: { [category: string]: number } = {};
  subCounts: { [subcategory: string]: number } = {};
  altCounts: { [alternate: string]: number } = {};

  private static readonly FILTERS_KEY = 'sockbowl_gen_filters';

  /** Queue a debounced refresh of the match-count preview after a filter change. */
  queueCount(): void {
    this.countingAvail = true;
    this.saveFilters();
    this.countSubject.next();
  }

  /** Persist the current Generate filters so repeat users don't re-pick every time. */
  private saveFilters(): void {
    try {
      localStorage.setItem(PacketSearchComponent.FILTERS_KEY, JSON.stringify({
        cats: this.qbSelectedCategories, tiers: this.qbSelectedTiers,
        subs: this.qbSelectedSubcategories, alts: this.qbSelectedAlternateSubcategories,
        indiv: this.qbIndividualDifficulties, tCount: this.qbTossupCount, bCount: this.qbBonusCount,
        minY: this.qbMinYear, maxY: this.qbMaxYear, std: this.qbStandardOnly, bal: this.qbBalanced
      }));
    } catch { /* localStorage unavailable — ignore */ }
  }

  private loadFilters(): void {
    try {
      const raw = localStorage.getItem(PacketSearchComponent.FILTERS_KEY);
      if (!raw) return;
      const f = JSON.parse(raw);
      if (Array.isArray(f.cats)) this.qbSelectedCategories = f.cats;
      if (Array.isArray(f.tiers)) this.qbSelectedTiers = f.tiers;
      if (Array.isArray(f.subs)) this.qbSelectedSubcategories = f.subs;
      if (Array.isArray(f.alts)) this.qbSelectedAlternateSubcategories = f.alts;
      if (Array.isArray(f.indiv)) this.qbIndividualDifficulties = f.indiv;
      if (typeof f.tCount === 'number') this.qbTossupCount = f.tCount;
      if (typeof f.bCount === 'number') this.qbBonusCount = f.bCount;
      this.qbMinYear = typeof f.minY === 'number' ? f.minY : null;
      this.qbMaxYear = typeof f.maxY === 'number' ? f.maxY : null;
      this.qbStandardOnly = !!f.std;
      this.qbBalanced = !!f.bal;
      this.filterSubs('');
      this.filterAlts('');
    } catch { /* corrupt/unavailable — ignore */ }
  }

  /** Whether any Generate filter differs from defaults (drives the Clear button). */
  get hasActiveFilters(): boolean {
    return this.qbSelectedCategories.length > 0 || this.qbSelectedSubcategories.length > 0 ||
      this.qbSelectedAlternateSubcategories.length > 0 || this.qbIndividualDifficulties.length > 0 ||
      this.qbMinYear != null || this.qbMaxYear != null || this.qbStandardOnly || this.qbBalanced ||
      this.qbSelectedTiers.length !== 1 || this.qbSelectedTiers[0] !== 'Regular HS';
  }

  clearFilters(): void {
    this.qbSelectedCategories = [];
    this.qbSelectedTiers = ['Regular HS'];
    this.qbSelectedSubcategories = [];
    this.qbSelectedAlternateSubcategories = [];
    this.qbIndividualDifficulties = [];
    this.qbMinYear = null;
    this.qbMaxYear = null;
    this.qbStandardOnly = false;
    this.qbBalanced = false;
    this.filterSubs('');
    this.filterAlts('');
    this.queueCount();
  }

  private refreshAvailability(): void {
    const body = this.buildRandomBody();
    this.sockbowlQuestionsService.countBankAvailable(body).subscribe({
      next: (r) => { this.availTossups = r.tossups; this.availBonuses = r.bonuses; this.countingAvail = false; },
      error: () => { this.availTossups = null; this.availBonuses = null; this.countingAvail = false; }
    });
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
  toggleQbCategory(category: string): void {
    const i = this.qbSelectedCategories.indexOf(category);
    if (i >= 0) this.qbSelectedCategories.splice(i, 1);
    else this.qbSelectedCategories.push(category);
    // Drop any picks that no longer belong to the selected categories, then refresh menus.
    const subs = this.qbAvailableSubcategories;
    this.qbSelectedSubcategories = this.qbSelectedSubcategories.filter(s => subs.includes(s));
    const alts = this.qbAvailableAlternateSubcategories;
    this.qbSelectedAlternateSubcategories = this.qbSelectedAlternateSubcategories.filter(s => alts.includes(s));
    this.filterSubs('');
    this.filterAlts('');
    this.queueCount();
  }

  /** Subcategories offered: those of the picked categories, or all of them if none picked. */
  get qbAvailableSubcategories(): string[] {
    return this.optionsFor(this.qbSubcategoriesByCategory);
  }

  /** Alternate subcategories offered, filtered the same way. */
  get qbAvailableAlternateSubcategories(): string[] {
    return this.optionsFor(this.qbAlternateByCategory);
  }

  private optionsFor(map: { [category: string]: string[] }): string[] {
    if (this.qbSelectedCategories.length) {
      return this.qbSelectedCategories.reduce<string[]>((acc, c) => acc.concat(map[c] || []), []);
    }
    return Object.keys(map).reduce<string[]>((acc, c) => acc.concat(map[c]), []);
  }

  /* --------------------- subcategory typeahead pickers -------------------- */

  /** Fuzzy-rank options against a query: prefix > substring > subsequence. */
  private fuzzyRank(pool: string[], query: string, selected: string[]): string[] {
    const available = pool.filter(o => !selected.includes(o));
    const q = query.trim().toLowerCase();
    if (!q) return available.slice(0, 12);
    const score = (opt: string): number => {
      const s = opt.toLowerCase();
      if (s.startsWith(q)) return 3;
      if (s.includes(q)) return 2;
      let i = 0;
      for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) i++;
      return i === q.length ? 1 : 0;
    };
    return available
      .map(o => ({o, s: score(o)}))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map(x => x.o)
      .slice(0, 12);
  }

  filterSubs(query: string): void {
    this.subFiltered = this.fuzzyRank(this.qbAvailableSubcategories, query, this.qbSelectedSubcategories);
  }

  addSub(value: string): void {
    if (value && !this.qbSelectedSubcategories.includes(value)) this.qbSelectedSubcategories.push(value);
    this.filterSubs('');
    this.queueCount();
  }

  removeSub(value: string): void {
    const i = this.qbSelectedSubcategories.indexOf(value);
    if (i >= 0) this.qbSelectedSubcategories.splice(i, 1);
    this.filterSubs('');
    this.queueCount();
  }

  filterAlts(query: string): void {
    this.altFiltered = this.fuzzyRank(this.qbAvailableAlternateSubcategories, query, this.qbSelectedAlternateSubcategories);
  }

  addAlt(value: string): void {
    if (value && !this.qbSelectedAlternateSubcategories.includes(value)) this.qbSelectedAlternateSubcategories.push(value);
    this.filterAlts('');
    this.queueCount();
  }

  removeAlt(value: string): void {
    const i = this.qbSelectedAlternateSubcategories.indexOf(value);
    if (i >= 0) this.qbSelectedAlternateSubcategories.splice(i, 1);
    this.filterAlts('');
    this.queueCount();
  }

  toggleQbTier(label: string): void {
    const i = this.qbSelectedTiers.indexOf(label);
    if (i >= 0) this.qbSelectedTiers.splice(i, 1);
    else this.qbSelectedTiers.push(label);
    this.queueCount();
  }

  toggleIndividualDifficulty(d: number): void {
    const i = this.qbIndividualDifficulties.indexOf(d);
    if (i >= 0) this.qbIndividualDifficulties.splice(i, 1);
    else this.qbIndividualDifficulties.push(d);
    this.queueCount();
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
      alternateSubcategories: this.qbSelectedAlternateSubcategories.length ? this.qbSelectedAlternateSubcategories : undefined,
      difficulties,
      minYear: this.qbMinYear ?? undefined,
      maxYear: this.qbMaxYear ?? undefined,
      standardOnly: this.qbStandardOnly || undefined,
      balanced: this.qbBalanced || undefined,
      tossupCount: this.qbTossupCount,
      bonusCount: this.qbBonusCount,
      name: this.qbRandomName?.trim() || undefined,
      excludeRemoteIds
    };
  }

  generateFromBank(): void {
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
          this.snackBar.open('Packet ready.', 'OK', { duration: 2500 });
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
    console.error('packet generation error:', err);
    this.snackBar.open('Could not build a packet. Try loosening the filters.', 'Close', { duration: 5000 });
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
