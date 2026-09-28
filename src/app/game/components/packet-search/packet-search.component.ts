import { Component, OnInit, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ImportRandomResult, SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { Packet } from '../../models/sockbowl/packet-types.generated';
import { PacketPage, PacketSummary } from '../../../packets/models/packet-authoring.models';
import { Subject, of, TimeoutError } from 'rxjs';
import { debounceTime, switchMap, catchError } from 'rxjs/operators';
import { AuthService } from '../../../core/auth/auth.service';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';
import { limitErrorFrom } from '../../../core/http/limit-errors';
import { metricLabel, resetsPhrase } from '../../../core/http/limit-messages';

const EMPTY_PACKET_PAGE: PacketPage = { items: [], total: 0, page: 0, size: 0 };

/** The AI tab's persistent inline banner for a fail-closed (D12) or quota (D10) response (S3-02). */
interface AiLimitBanner {
  icon: string;
  title: string;
  message: string;
}

@Component({
    selector: 'app-packet-search',
    templateUrl: './packet-search.component.html',
    styleUrls: [
        './packet-search.component.scss',
        './packet-search-generate.component.scss',
        './packet-search-qbreader.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PacketSearchComponent implements OnInit {
  private dialogRef = inject<MatDialogRef<PacketSearchComponent>>(MatDialogRef);
  private sockbowlQuestionsService = inject(SockbowlQuestionsService);
  private snackBar = inject(MatSnackBar);
  private rateLimitState = inject(RateLimitStateService);
  auth = inject(AuthService);
  data = inject(MAT_DIALOG_DATA);

  /** True while the `ai-generate` policy is cooling down after a 429 (M4-UI-01). */
  readonly generateLocked = computed(() => this.rateLimitState.cooldown('ai-generate')() > 0);
  /** True while the `import`/`import-ip` policy is cooling down after a 429 (M4-UI-01). */
  readonly importLocked = computed(() => this.rateLimitState.cooldown('import')() > 0);

  // Search tab properties. Both lists are the answer-free, policy-filtered
  // PacketSummary projection (`listPackets`, PB-19), not full Packet objects;
  // confirmSelection() fetches the full packet only once a choice is made.
  searchQuery = "";
  searchResults: PacketSummary[] = [];
  // "My packets" (PB-14): the caller's own packets, most recent first, shown
  // above search results when authenticated. Built entirely from the
  // server's `mine: true` filter — never from comparing `owner.id` against
  // the current user, since the API nulls `owner.id` for non-owners (an M2
  // fix) and that comparison would silently under- or over-match.
  myPackets: PacketSummary[] = [];
  myPacketsLoading = false;
  /** "My packets" failed to load (S3-01) — distinct from a true empty result. */
  myPacketsError = false;
  selectedPacketId = "";
  isSearching = false;
  /** The debounced search itself failed (S3-01) — distinct from a true "no results". */
  searchError = false;
  /** Set from generateAIPacket()'s 429/503 response (S3-02); null once cleared or never hit. */
  aiLimitBanner: AiLimitBanner | null = null;
  /** True while confirmSelection() is fetching the full packet to hand back. */
  selectionLoading = false;
  private searchSubject = new Subject<string>();

  /**
   * Which tab is active (S3-07). The "Question bank" tab commits inline
   * (`generateFromBank()` closes the dialog itself), so the shared footer
   * "Use Packet" button is hidden while it's active — one commit per tab.
   * Index 1 always names it: Library(0), Question bank(1), AI(2, gated).
   */
  selectedTabIndex = 0;
  readonly QUESTION_BANK_TAB_INDEX = 1;

  // Generate tab properties
  generateTopic = "";
  generateContext = "";
  questionCount = 5;  // Default to 5, max 30
  generateBonuses = true;  // Default to true
  isGenerating = false;
  generatedPacket: Packet | null = null;

  // Generate-tab state
  qbImporting = false;

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
  readonly qbSubcategoriesByCategory: Record<string, string[]> = {
    'Literature': ['American Literature', 'British Literature', 'Classical Literature',
                   'European Literature', 'World Literature', 'Other Literature'],
    'History': ['American History', 'Ancient History', 'European History',
                'World History', 'Other History'],
    'Science': ['Biology', 'Chemistry', 'Physics', 'Other Science'],
    'Fine Arts': ['Visual Fine Arts', 'Auditory Fine Arts', 'Other Fine Arts'],
    'Pop Culture': ['Movies', 'Music', 'Sports', 'Television', 'Video Games', 'Other Pop Culture']
  };
  // qbreader's ALTERNATE subcategories — a finer, separate filter dimension.
  readonly qbAlternateByCategory: Record<string, string[]> = {
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
  qbTossupCount = 20;
  qbBonusCount = 20;
  qbRandomName = '';

  // Advanced qbreader filters (all optional).
  qbShowAdvanced = false;
  readonly qbAllDifficulties: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  qbIndividualDifficulties: number[] = []; // if any selected, overrides the coarse tiers
  qbSelectedSubcategories: string[] = [];  // picked from the taxonomy above
  qbSelectedAlternateSubcategories: string[] = [];
  // Ranked options shown in each typeahead's autocomplete panel.
  subFiltered: string[] = [];
  altFiltered: string[] = [];
  qbMinYear: number | null = null;
  qbMaxYear: number | null = null;
  qbStandardOnly = false;
  // Spread the mix across categories instead of a pure random draw.
  qbBalanced = false;
  // De-dupe against questions this account has already seen (logged-in only).
  qbAvoidRepeats = true;

  // API configuration properties. The key/model fields, remember-key
  // persistence and model-fetch state now live in AiKeyPickerComponent
  // (shared/ai-key, PB-08); this component only keeps the values it needs
  // to send on generate and to validate the form.
  apiKey = '';
  selectedModel = '';
  validationError: string | null = null;

  // LLM parameter properties with defaults
  temperature = 1.0;
  topP = 1.0;
  frequencyPenalty = 0.0;
  presencePenalty = 0.0;

  // Parameter visibility flags
  supportsTemperature = true;
  supportsTopP = true;
  supportsFrequencyPenalty = true;
  supportsPresencePenalty = true;

  // Model parameter support mapping
  private readonly MODEL_PARAMS: Record<string, string[]> = {
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

  ngOnInit(): void {
    // Set up debounced search. switchMap cancels the in-flight request when a newer
    // query arrives, so a slow response for an earlier query can never overwrite the
    // results of a later one (the classic search race). Uses the paginated,
    // answer-free `listPackets` projection (PB-19) rather than the deprecated
    // full-detail `searchPacketsByName`.
    this.searchSubject.pipe(
      debounceTime(300),
      // No distinctUntilChanged: Retry (S3-01) re-emits the same, unchanged
      // searchQuery to re-run a failed search, and that resubmission must not
      // be swallowed as a "duplicate" of the query that just failed.
      switchMap(query => {
        if (!query || query.length < 2) {
          this.isSearching = false;
          this.searchError = false;
          return of(EMPTY_PACKET_PAGE);
        }
        this.isSearching = true;
        this.searchError = false;
        return this.sockbowlQuestionsService.listPackets({ nameContains: query }, 0, 25).pipe(
          catchError(error => {
            console.error('Search error:', error);
            this.searchError = true;
            return of(EMPTY_PACKET_PAGE);
          })
        );
      })
    ).subscribe(page => {
      this.searchResults = page.items;
      this.isSearching = false;
    });

    if (this.auth.isAuthenticated()) {
      this.loadMyPackets();
    }

    // Update the LLM-parameter visibility for the (empty) starting model
    // selection. AiKeyPickerComponent supplies the actual saved key/model
    // and re-fires (modelChange) once it does.
    this.updateParameterVisibility();

    // Live "how many match" preview for the Generate tab (debounced).
    // switchMap so a slow count response for an earlier filter set can't overwrite
    // the count for the current filters (same race as the name search above).
    this.countSubject.pipe(
      debounceTime(350),
      switchMap(() => this.sockbowlQuestionsService.countBankAvailable(this.buildRandomBody()).pipe(
        catchError(() => of(null))
      ))
    ).subscribe(r => {
      if (r) {
        this.availTossups = r.tossups;
        this.availBonuses = r.bonuses;
      } else {
        this.availTossups = null;
        this.availBonuses = null;
      }
      this.countingAvail = false;
    });
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

  /** Load the caller's own packets (PB-14), most recent first, up to 10. */
  loadMyPackets(): void {
    this.myPacketsLoading = true;
    this.myPacketsError = false;
    this.sockbowlQuestionsService.listPackets({ mine: true }, 0, 10).subscribe({
      next: (page) => {
        this.myPackets = page.items;
        this.myPacketsLoading = false;
      },
      error: (error) => {
        console.error('Could not load My packets:', error);
        this.myPackets = [];
        this.myPacketsLoading = false;
        this.myPacketsError = true;
      }
    });
  }

  /* ----------------------- Generate breadth preview ---------------------- */

  private countSubject = new Subject<void>();
  availTossups: number | null = null;
  availBonuses: number | null = null;
  countingAvail = false;
  categoryCounts: Record<string, number> = {};
  subCounts: Record<string, number> = {};
  altCounts: Record<string, number> = {};

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

  selectPacket(packet: PacketSummary): void {
    this.selectedPacketId = packet.id;
  }

  /** (modelChange) from AiKeyPickerComponent: also refresh the LLM-parameter visibility. */
  onGenerateModelChange(model: string): void {
    this.selectedModel = model;
    this.updateParameterVisibility();
  }

  generateAIPacket(): void {
    // Validate all required fields
    if (!this.validateGenerationForm()) {
      return;
    }

    // Clear previous validation errors
    this.validationError = null;
    this.aiLimitBanner = null;

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
      error: (err: HttpErrorResponse | TimeoutError) => {
        console.error('Generation error:', err);
        this.isGenerating = false;
        this.aiLimitBanner = null;

        // The 660s client-side timeout (rxjs `timeout()`) throws a
        // TimeoutError, never an HttpErrorResponse — keep it out of the
        // status-code checks below rather than mistyping it as one.
        if (err instanceof TimeoutError) {
          this.snackBar.open('Request timed out. The generation may still be processing.', 'Close', {
            duration: 5000
          });
          return;
        }
        const error = err;

        // A 429 (rate_limited/quota_exceeded) or 503 (limiter_unavailable) is
        // already surfaced by the global RateLimitInterceptor's single
        // snackbar; render the persistent inline banner ourselves (S3-02),
        // since the interceptor has no view to put one in.
        if (error.status === 429 || error.status === 503) {
          this.aiLimitBanner = this.classifyLimitBanner(error);
          return;
        }

        // Handle different error types
        let errorMessage = 'Error generating packet. Please try again.';
        if (error.status === 400) {
          errorMessage = 'Invalid request. Please check your API key and model selection.';
        } else if (error.status === 401) {
          errorMessage = 'Invalid API key. Please check your OpenAI API key.';
        } else if (error.status === 502) {
          // The AI provider (not our own limiter) rate-limited the server-side call.
          errorMessage = 'The AI provider is rate-limiting requests. Please try again later.';
        }

        this.snackBar.open(errorMessage, 'Close', {
          duration: 5000
        });
      }
    });
  }

  /**
   * Classifies a 429/503 `generatePacket` response into the AI tab's
   * persistent banner copy (S3-02: D12 fail-closed, D10 quota). Returns null
   * for anything `limitErrorFrom` doesn't recognize, so the generic snackbar
   * path still runs for those.
   */
  private classifyLimitBanner(error: HttpErrorResponse): AiLimitBanner | null {
    const body = (error.error && typeof error.error === 'object' ? error.error : {}) as Record<string, unknown>;
    const classification = typeof body['error'] === 'string' ? (body['error'] as string) : undefined;
    const limitError = limitErrorFrom(classification, body);
    if (!limitError) {
      return null;
    }
    switch (limitError.kind) {
      case 'limiter_unavailable':
        return {
          icon: 'cloud_off',
          title: "AI generation isn't available right now",
          message: 'The generator is temporarily offline. Try again shortly, or use the question bank tab instead.',
        };
      case 'quota_exceeded': {
        const label = metricLabel(limitError.metric);
        const limitText = limitError.limit != null ? ` (${limitError.limit})` : '';
        return {
          icon: 'hourglass_top',
          title: `You've reached your ${label} limit${limitText}`,
          message: `Resets ${resetsPhrase(limitError.resetsAt)}. Use the question bank tab instead in the meantime.`,
        };
      }
      case 'rate_limited':
        return {
          icon: 'hourglass_top',
          title: 'Slow down',
          message: `Try again in ${Math.max(1, Math.ceil(limitError.retryAfterSeconds || 1))}s, or use the question bank tab instead.`,
        };
      default:
        return null;
    }
  }

  /** The AI banner's "use the question bank instead" action (S3-02). */
  goToQuestionBankTab(): void {
    this.selectedTabIndex = this.QUESTION_BANK_TAB_INDEX;
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

    // Otherwise fetch the full packet for what was picked from "My packets" or
    // search (both only carry the answer-free PacketSummary projection).
    if (!this.selectedPacketId || this.selectionLoading) {
      return;
    }
    this.selectionLoading = true;
    this.sockbowlQuestionsService.getPacketById(this.selectedPacketId).subscribe({
      next: (packet) => {
        this.selectionLoading = false;
        if (packet) {
          this.dialogRef.close(packet);
        } else {
          this.snackBar.open('Could not load that packet.', 'Close', { duration: 4000 });
        }
      },
      error: (error) => {
        console.error('Could not load the selected packet:', error);
        this.selectionLoading = false;
        this.snackBar.open('Could not load that packet.', 'Close', { duration: 4000 });
      }
    });
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

  private optionsFor(map: Record<string, string[]>): string[] {
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

  private afterRandomImport(res: ImportRandomResult): void {
    // Record what this account was served, so future generations avoid it. Fire-and-forget.
    if (this.qbDedupActive && res.usedRemoteIds && res.usedRemoteIds.length) {
      this.sockbowlQuestionsService.recordUsedQuestionIds(res.usedRemoteIds).subscribe({ error: () => { /* best-effort; ignore */ } });
    }
    this.qbImporting = false;
    if (!res?.id) {
      this.onQbImportError(null);
      return;
    }
    // S3-07: the game-config screen already confirms with its own
    // "Packet '<name>' selected." toast once the dialog closes (every
    // commit path funnels through there) — a second one here just doubled up.
    this.dialogRef.close(PacketSearchComponent.packetFromImport(res));
  }

  /**
   * The config screen's view of a just-generated packet, built from the
   * import-random response alone. The packet is never re-read from questions:
   * with auth on, a guest's or player's generated packet is EPHEMERAL (D15),
   * which only the game service may read (getPacketById returns null to
   * everyone else, NG-R3-01). The game server supplies the proctor's full
   * packet once it is set (D2). The questions and bonuses arrays are
   * length-only, like the ones MatchPacketUpdate produces, so the config
   * screen can show the counts but never holds question text.
   */
  private static packetFromImport(res: ImportRandomResult): Packet {
    return {
      id: res.id,
      name: res.name,
      tossups: new Array(Math.max(0, res.tossupCount ?? 0)),
      bonuses: new Array(Math.max(0, res.bonusCount ?? 0)),
    } as unknown as Packet;
  }

  private onQbImportError(err: any): void {
    this.qbImporting = false;
    console.error('packet generation error:', err);
    // A 429 (rate_limited/quota_exceeded) or 503 is already surfaced by the
    // global RateLimitInterceptor, with a cooldown on the Import button above.
    if (err?.status === 429 || err?.status === 503) {
      return;
    }
    this.snackBar.open('Could not build a packet. Try loosening the filters.', 'Close', { duration: 5000 });
  }

  /** "Open the builder" action on the true-empty "My packets" state (S3-14). */
  openBuilder(): void {
    window.open('/packets', '_blank', 'noopener');
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
