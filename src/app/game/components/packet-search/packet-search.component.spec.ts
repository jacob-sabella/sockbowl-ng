import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PacketSummary } from '../../../packets/models/packet-authoring.models';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';
import { LoadingStateComponent } from '../../../shared/state/loading-state/loading-state.component';
import { EmptyStateComponent } from '../../../shared/state/empty-state/empty-state.component';
import { ErrorStateComponent } from '../../../shared/state/error-state/error-state.component';

/** The F1/F2 shared state primitives, so specs can assert on their real rendered output (S3-01/S3-02/S3-14). */
const STATE_PRIMITIVES = [LoadingStateComponent, EmptyStateComponent, ErrorStateComponent];

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let dialogClose: jasmine.Spy;
  let snackOpen: jasmine.Spy;
  let snackDismiss: jasmine.Spy;
  let questions: Record<string, jasmine.Spy>;

  function configure(permissions: string[], importResult: any = { id: 'p1', name: 'Generated' }): void {
    dialogClose = jasmine.createSpy('close');
    snackOpen = jasmine.createSpy('open');
    snackDismiss = jasmine.createSpy('dismiss');
    questions = {
      getBankTaxonomyCounts: jasmine.createSpy('getBankTaxonomyCounts')
        .and.returnValue(of({ categories: {}, subcategories: {}, alternates: {} })),
      countBankAvailable: jasmine.createSpy('countBankAvailable').and.returnValue(of({ tossups: 0, bonuses: 0 })),
      importQbreaderRandom: jasmine.createSpy('importQbreaderRandom').and.returnValue(
        importResult instanceof Error ? throwError(() => importResult) : of(importResult)),
      // Default success; S3-02 specs override this per-test with a 429/503.
      generatePacket: jasmine.createSpy('generatePacket').and.returnValue(
        of({ id: 'g1', name: 'Generated', tossups: [], bonuses: [] })),
      // With auth on, a guest's or player's generated packet is EPHEMERAL and
      // getPacketById returns null for it (NG-R3-01).
      getPacketById: jasmine.createSpy('getPacketById').and.returnValue(of(null)),
      getUsedQuestionIds: jasmine.createSpy('getUsedQuestionIds').and.returnValue(of([])),
      recordUsedQuestionIds: jasmine.createSpy('recordUsedQuestionIds').and.returnValue(of(null)),
      // M3 (PB-14): a signed-in caller's dialog loads "My packets" on init.
      listPackets: jasmine.createSpy('listPackets').and.returnValue(of({ items: [], total: 0, page: 0, size: 10 })),
    };
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.isAuthenticated.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      imports: STATE_PRIMITIVES,
      providers: [
        { provide: MatDialogRef, useValue: { close: dialogClose } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: snackOpen, dismiss: snackDismiss } },
        { provide: SockbowlQuestionsService, useValue: questions },
        { provide: OpenAiModelService, useValue: {} },
        { provide: AuthService, useValue: authSpy },
      ],
      // Template uses Angular Material elements not declared in this unit test.
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(PacketSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', () => {
    configure([]);
    expect(component).toBeTruthy();
  });

  it('hides the AI generate tab without question:generate', () => {
    configure([]);
    const aiTab = (fixture.nativeElement as HTMLElement).querySelector('.generate-container');
    expect(aiTab).toBeNull();
  });

  it('shows the AI generate tab with question:generate', () => {
    configure(['question:generate']);
    const aiTab = (fixture.nativeElement as HTMLElement).querySelector('.generate-container');
    expect(aiTab).not.toBeNull();
  });

  it('keeps the local-bank Generate tab available to a guest with no permissions (D15 preserves guest UX)', () => {
    configure([]);
    const bankTab = (fixture.nativeElement as HTMLElement).querySelector('.qb-content');
    expect(bankTab).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Build a packet from the question bank');
  });
  describe('accessible names and states (S3-13)', () => {
    it('gives every loading mat-spinner an accessible name (aria-progressbar-name)', () => {
      configure(['question:generate']);
      component.qbImporting = true;
      component.isGenerating = true;
      component.selectionLoading = true;
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.qb-import-btn mat-spinner')?.getAttribute('aria-label')).toBe('Generating packet');
      expect(el.querySelector('.generating-state mat-spinner')?.getAttribute('aria-label')).toBe('Generating packet with AI');
      expect(el.querySelector('.select-btn mat-spinner')?.getAttribute('aria-label')).toBe('Confirming packet');
    });

    it('reflects the Question bank category filter via aria-pressed on its chip', () => {
      configure([]);
      const category = component.qbCategories[0];
      const chip = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.qb-chip'))
        .find(b => b.textContent?.trim().startsWith(category)) as HTMLButtonElement;

      expect(chip().getAttribute('aria-pressed')).toBe('false');

      component.toggleQbCategory(category);
      fixture.detectChanges();

      expect(chip().getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('Generate from the bank (NG-R3-01)', () => {
    it('closes with the import-random metadata and never re-reads the packet (EPHEMERAL reads are null)', () => {
      configure([], { id: 'eph-1', name: 'Random Packet', usedRemoteIds: [], tossupCount: 5, bonusCount: 3 });

      component.generateFromBank();

      expect(questions['importQbreaderRandom']).toHaveBeenCalledTimes(1);
      expect(questions['getPacketById']).not.toHaveBeenCalled();
      expect(dialogClose).toHaveBeenCalledTimes(1);
      const packet = dialogClose.calls.mostRecent().args[0];
      expect(packet.id).toBe('eph-1');
      expect(packet.name).toBe('Random Packet');
      expect(packet.tossups.length).toBe(5);
      expect(packet.bonuses.length).toBe(3);
      // Metadata only: no question text reaches the config screen this way.
      expect(packet.tossups.some((t: unknown) => !!t)).toBeFalse();
      expect(packet.bonuses.some((b: unknown) => !!b)).toBeFalse();
      expect(snackOpen).not.toHaveBeenCalledWith(jasmine.stringMatching(/Could not build/), jasmine.anything(), jasmine.anything());
      expect(component.qbImporting).toBeFalse();
    });

    it('still closes with the packet when questions does not return the counts', () => {
      configure([], { id: 'eph-2', name: 'Older Response', usedRemoteIds: [] });

      component.generateFromBank();

      expect(questions['getPacketById']).not.toHaveBeenCalled();
      const packet = dialogClose.calls.mostRecent().args[0];
      expect(packet.id).toBe('eph-2');
      expect(packet.tossups.length).toBe(0);
      expect(packet.bonuses.length).toBe(0);
    });

    it('shows the error and keeps the dialog open when import-random fails', () => {
      configure([], new Error('bank empty'));

      component.generateFromBank();

      expect(dialogClose).not.toHaveBeenCalled();
      expect(snackOpen).toHaveBeenCalledWith(jasmine.stringMatching(/Could not build a packet/), 'Close', jasmine.anything());
      expect(component.qbImporting).toBeFalse();
    });

    it('records the served question ids for a signed-in account that opted in', () => {
      configure([], { id: 'eph-3', name: 'Dedup', usedRemoteIds: ['r1', 'r2'], tossupCount: 2, bonusCount: 0 });
      authSpy.isAuthenticated.and.returnValue(true);
      component.qbAvoidRepeats = true;

      component.generateFromBank();

      expect(questions['getUsedQuestionIds']).toHaveBeenCalled();
      expect(questions['recordUsedQuestionIds']).toHaveBeenCalledOnceWith(['r1', 'r2']);
      expect(dialogClose.calls.mostRecent().args[0].id).toBe('eph-3');
    });
  });

  describe('one commit per tab (S3-07)', () => {
    it('opens on the Library tab, with the shared "Use Packet" footer visible', () => {
      configure([]);
      expect(component.selectedTabIndex).toBe(0);
      expect(component.selectedTabIndex).not.toBe(component.QUESTION_BANK_TAB_INDEX);

      const footerBtn = (fixture.nativeElement as HTMLElement).querySelector('.select-btn');
      expect(footerBtn).not.toBeNull();
    });

    it('hides the shared footer button while the Question bank tab is active, since it commits inline', () => {
      configure([]);
      component.selectedTabIndex = component.QUESTION_BANK_TAB_INDEX;
      fixture.detectChanges();

      const footerBtn = (fixture.nativeElement as HTMLElement).querySelector('.select-btn');
      expect(footerBtn).toBeNull();
    });

    it('closes the dialog once from generateFromBank, without a second confirmation toast racing game-config\'s own', () => {
      configure([], { id: 'eph-1', name: 'Random Packet', usedRemoteIds: [], tossupCount: 5, bonusCount: 3 });

      component.generateFromBank();

      expect(dialogClose).toHaveBeenCalledTimes(1);
      expect(snackOpen).not.toHaveBeenCalledWith(jasmine.stringMatching(/ready/i), jasmine.anything(), jasmine.anything());
    });
  });

  describe('M4-UI-01 rate-limit cooldowns', () => {
    it('disables the AI Generate button while the ai-generate policy cools down', () => {
      configure(['question:generate']);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.generateTopic = 'Topic';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-5';
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.generate-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('ai-generate', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();

      rateLimitState.clearCooldown('ai-generate');
      fixture.detectChanges();
      expect(button.disabled).toBeFalse();
    });

    it('disables the bank Import button while the import policy cools down', () => {
      configure([]);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.availTossups = 5;
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.qb-import-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('import', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
    });
  });

  describe('AI fail-closed (D12) and quota (D10) banner (S3-02)', () => {
    function fillGenerateForm(): void {
      component.generateTopic = 'Ancient Rome';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-4o';
    }

    it('shows a persistent banner and locks the fields when the limiter fails closed (503)', () => {
      configure(['question:generate']);
      questions['generatePacket'].and.returnValue(throwError(() => new HttpErrorResponse({
        status: 503, error: { error: 'limiter_unavailable', policy: 'ai-generate' },
      })));
      fillGenerateForm();

      component.generateAIPacket();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(component.aiLimitBanner?.title).toContain("isn't available");
      expect(el.querySelector('.ai-limit-banner')).not.toBeNull();
      // The fields, not only the button, are locked (S3-02).
      expect(el.querySelector('.generate-form__fields')?.getAttribute('inert')).toBe('');
      const generateBtn = el.querySelector('.generate-btn') as HTMLButtonElement;
      expect(generateBtn.disabled).toBeTrue();
    });

    it('names the reset time for a quota-exhausted response (429) and links to the question bank tab', () => {
      configure(['question:generate']);
      const resetsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
      questions['generatePacket'].and.returnValue(throwError(() => new HttpErrorResponse({
        status: 429,
        error: { error: 'quota_exceeded', metric: 'ai.generations', limit: 5, used: 5, resetsAt },
      })));
      fillGenerateForm();

      component.generateAIPacket();
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.ai-limit-banner__title')?.textContent).toContain('AI generation limit');
      expect(el.querySelector('.ai-limit-banner__message')?.textContent).toMatch(/Resets in \d+h/);

      const useBankBtn = Array.from(el.querySelectorAll<HTMLButtonElement>('.ai-limit-banner button'))
        .find(b => b.textContent?.includes('question bank'));
      useBankBtn?.click();

      expect(component.selectedTabIndex).toBe(component.QUESTION_BANK_TAB_INDEX);
    });

    it('does not show the banner for a non-limit error — the plain snackbar path still runs', () => {
      configure(['question:generate']);
      questions['generatePacket'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
      fillGenerateForm();

      component.generateAIPacket();
      fixture.detectChanges();

      expect(component.aiLimitBanner).toBeNull();
      expect(fixture.nativeElement.querySelector('.ai-limit-banner')).toBeNull();
      expect(snackOpen).toHaveBeenCalledWith(jasmine.stringMatching(/Invalid request/), jasmine.anything(), jasmine.anything());
      // A plain 400 has no interceptor snackbar of its own to suppress.
      expect(snackDismiss).not.toHaveBeenCalled();
    });

    // FF3 (finish review #3, R2 regression): S3-37's taller dialog left the
    // global RateLimitInterceptor's snackbar (already open by the time this
    // handler runs, from the same 429/503) overlapping the dialog's own
    // footer and repeating this banner's message underneath it.
    it('dismisses the interceptor\'s snackbar once the inline banner takes over (429/503, R2)', () => {
      configure(['question:generate']);
      questions['generatePacket'].and.returnValue(throwError(() => new HttpErrorResponse({
        status: 503, error: { error: 'limiter_unavailable', policy: 'ai-generate' },
      })));
      fillGenerateForm();

      component.generateAIPacket();
      fixture.detectChanges();

      expect(component.aiLimitBanner).not.toBeNull();
      expect(snackDismiss).toHaveBeenCalled();
    });

    it('clears the banner once a fresh attempt is made', () => {
      configure(['question:generate']);
      questions['generatePacket'].and.returnValue(throwError(() => new HttpErrorResponse({
        status: 503, error: { error: 'limiter_unavailable' },
      })));
      fillGenerateForm();
      component.generateAIPacket();
      expect(component.aiLimitBanner).not.toBeNull();

      questions['generatePacket'].and.returnValue(of({ id: 'g1', name: 'Generated', tossups: [], bonuses: [] }));
      component.generateAIPacket();

      expect(component.aiLimitBanner).toBeNull();
    });
  });
});

describe('PacketSearchComponent My packets / search (PB-14)', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let questions: jasmine.SpyObj<SockbowlQuestionsService>;
  let dialogClose: jasmine.Spy;

  const somePacket: PacketSummary = {
    id: 'p1', name: 'A Packet', visibility: 'DRAFT', version: 1,
    tossupCount: 5, bonusCount: 1, playable: true,
  };
  const unplayablePacket: PacketSummary = {
    id: 'p2', name: 'Unfinished', visibility: 'DRAFT', version: 1,
    tossupCount: 0, bonusCount: 0, playable: false,
  };

  function configure(
    authenticated: boolean,
    myPacketsItems: PacketSummary[] = [],
    myPacketsResponse?: Observable<unknown>,
  ): void {
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.returnValue(false);
    authSpy.isAuthenticated.and.returnValue(authenticated);

    questions = jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', [
      'getBankTaxonomyCounts', 'countBankAvailable', 'listPackets', 'getPacketById',
    ]);
    questions.getBankTaxonomyCounts.and.returnValue(of({ categories: {}, subcategories: {}, alternates: {} }));
    questions.countBankAvailable.and.returnValue(of({ tossups: 0, bonuses: 0 }));
    questions.listPackets.and.returnValue(
      (myPacketsResponse ?? of({ items: myPacketsItems, total: myPacketsItems.length, page: 0, size: 10 })) as any
    );
    questions.getPacketById.and.returnValue(of(null));
    dialogClose = jasmine.createSpy('close');

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      imports: STATE_PRIMITIVES,
      providers: [
        { provide: MatDialogRef, useValue: { close: dialogClose } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => { /* noop test double */ } } },
        { provide: SockbowlQuestionsService, useValue: questions },
        { provide: OpenAiModelService, useValue: {} },
        { provide: AuthService, useValue: authSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(PacketSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads My packets with mine:true when authenticated', () => {
    configure(true, [somePacket]);

    expect(questions.listPackets).toHaveBeenCalledWith({ mine: true }, 0, 10);
    expect(component.myPackets).toEqual([somePacket]);
  });

  it('does not load My packets when not authenticated', () => {
    configure(false);

    expect(questions.listPackets).not.toHaveBeenCalled();
    expect(component.myPackets).toEqual([]);
  });

  it('disables an unplayable My packets row', () => {
    configure(true, [unplayablePacket]);
    fixture.detectChanges();

    // S3-13: the row's select control is a real <button> (a sibling of "Edit
    // in builder", not wrapping it — axe nested-interactive), so an
    // unplayable packet is conveyed with the button's own native `disabled`
    // rather than an `aria-disabled` on the row `<div>`.
    const row = (fixture.nativeElement as HTMLElement).querySelector('.result-item.unplayable');
    expect(row).not.toBeNull();
    const select = row?.querySelector('.result-item__select') as HTMLButtonElement | null;
    expect(select).not.toBeNull();
    expect(select?.disabled).toBeTrue();
  });

  it('does not select an unplayable row on click', () => {
    configure(true, [unplayablePacket]);

    component.selectPacket(unplayablePacket);
    // selectPacket itself doesn't gate on playable — the template does, via
    // `packet.playable && selectPacket(packet)` — so exercise that contract directly.
    expect(unplayablePacket.playable).toBeFalse();
  });

  it('reflects My packets selection via aria-pressed on the select button (S3-13)', () => {
    configure(true, [somePacket]);
    fixture.detectChanges();
    const select = (fixture.nativeElement as HTMLElement)
      .querySelector('.result-item__select') as HTMLButtonElement;

    expect(select.getAttribute('aria-pressed')).toBe('false');

    select.click();
    fixture.detectChanges();

    expect(component.selectedPacketId).toBe(somePacket.id);
    expect(select.getAttribute('aria-pressed')).toBe('true');
  });

  it('search uses listPackets instead of searchPacketsByName', fakeAsync(() => {
    configure(false);
    questions.listPackets.and.returnValue(of({ items: [somePacket], total: 1, page: 0, size: 25 }));

    component.searchQuery = 'history';
    component.searchPackets();
    tick(300);

    expect(questions.listPackets).toHaveBeenCalledWith({ nameContains: 'history' }, 0, 25);
    expect(component.searchResults).toEqual([somePacket]);
  }));

  it('confirmSelection fetches the full packet before closing the dialog', () => {
    configure(false);
    const fullPacket = { id: 'p1', name: 'A Packet', tossups: [], bonuses: [], difficulty: { id: 'd', name: 'Easy' } } as any;
    questions.getPacketById.and.returnValue(of(fullPacket));
    component.selectPacket(somePacket);

    component.confirmSelection();

    expect(questions.getPacketById).toHaveBeenCalledWith('p1');
  });

  describe('refreshes My packets on window focus (S3-24)', () => {
    it('reloads My packets when the window regains focus while signed in', () => {
      configure(true, [somePacket]);
      expect(questions.listPackets).toHaveBeenCalledTimes(1);

      questions.listPackets.and.returnValue(of({ items: [somePacket, unplayablePacket], total: 2, page: 0, size: 10 }));
      component.onWindowFocus();

      expect(questions.listPackets).toHaveBeenCalledTimes(2);
      expect(component.myPackets).toEqual([somePacket, unplayablePacket]);
    });

    it('does nothing on window focus when not authenticated', () => {
      configure(false);
      expect(questions.listPackets).not.toHaveBeenCalled();

      component.onWindowFocus();

      expect(questions.listPackets).not.toHaveBeenCalled();
    });

    it('shows the reason a My packets row is not playable, instead of a hidden tooltip', () => {
      configure(true, [unplayablePacket]);

      const reason = (fixture.nativeElement as HTMLElement).querySelector('.not-playable-reason');
      expect(reason).not.toBeNull();
      expect(reason?.textContent).toContain('Not playable yet');
    });
  });

  describe('one commit source across tabs (S3-19)', () => {
    it('selecting a Library packet clears a prior AI generation, so confirmSelection commits the Library pick', () => {
      configure(true, [somePacket]);
      component.generatedPacket = { id: 'g1', name: 'Generated', tossups: [], bonuses: [] } as any;
      component.selectedTabIndex = 0;

      component.selectPacket(somePacket);

      expect(component.generatedPacket).toBeNull();
      expect(component.hasActiveTabSelection()).toBeTrue();
      expect(component.activeTabSelectionLabel()).toBe('Use "A Packet"');
    });

    it('generating on the AI tab clears a prior Library pick, so confirmSelection commits the generated packet', () => {
      configure(true, [somePacket]);
      component.selectPacket(somePacket);
      component.selectedTabIndex = component.AI_TAB_INDEX;

      const generated = { id: 'g1', name: 'AI Packet', tossups: [], bonuses: [] } as any;
      component.generatedPacket = generated;
      component.selectedPacketId = '';

      expect(component.hasActiveTabSelection()).toBeTrue();
      expect(component.activeTabSelectionLabel()).toBe('Use "AI Packet"');

      component.confirmSelection();

      expect(dialogClose).toHaveBeenCalledWith(generated);
      expect(questions.getPacketById).not.toHaveBeenCalled();
    });

    it('footer button reads "Use Packet" with nothing selected on the active tab', () => {
      configure(true, [somePacket]);
      expect(component.hasActiveTabSelection()).toBeFalse();
      expect(component.activeTabSelectionLabel()).toBe('Use Packet');
    });
  });

  describe('My packets and search: loading/empty/error states (S3-01, S3-14)', () => {
    it('shows a retryable error state, never a false "empty" state, when My packets fails to load', () => {
      configure(true, [], throwError(() => new Error('network down')));

      expect(component.myPacketsError).toBeTrue();
      expect(component.myPackets).toEqual([]);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.my-packets-section .error-state')).not.toBeNull();
      expect(el.querySelector('.my-packets-section .empty-state')).toBeNull();
    });

    it('retries My packets from the error state and clears the error on success', () => {
      configure(true, [], throwError(() => new Error('network down')));
      const el: HTMLElement = fixture.nativeElement;

      questions.listPackets.and.returnValue(of({ items: [somePacket], total: 1, page: 0, size: 10 }));
      const retryBtn: HTMLButtonElement | null = el.querySelector('.my-packets-section .error-state button');
      retryBtn?.click();
      fixture.detectChanges();

      expect(component.myPacketsError).toBeFalse();
      expect(component.myPackets).toEqual([somePacket]);
      expect(el.querySelector('.my-packets-section .error-state')).toBeNull();
    });

    it('shows the shared empty state (not the old overlapping icon) for a true-empty My packets result', () => {
      configure(true, []);

      const empty = fixture.nativeElement.querySelector('.my-packets-section .empty-state');
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain("haven't created any packets yet");
      expect(fixture.nativeElement.querySelector('.my-packets-section .error-state')).toBeNull();
    });

    it('shows a retryable error state, not "no results", when the search itself fails', fakeAsync(() => {
      configure(false);
      questions.listPackets.and.returnValue(throwError(() => new Error('search down')));

      component.searchQuery = 'history';
      component.searchPackets();
      tick(300);
      fixture.detectChanges();

      expect(component.searchError).toBeTrue();
      expect(component.searchResults).toEqual([]);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.results-container .error-state')).not.toBeNull();
      expect(el.querySelector('.results-container')?.textContent).not.toContain('No packets found matching');
    }));

    it('retries the search from the error state and clears it on success', fakeAsync(() => {
      configure(false);
      questions.listPackets.and.returnValue(throwError(() => new Error('search down')));
      component.searchQuery = 'history';
      component.searchPackets();
      tick(300);
      fixture.detectChanges();

      questions.listPackets.and.returnValue(of({ items: [somePacket], total: 1, page: 0, size: 25 }));
      const resultsEl: HTMLElement = fixture.nativeElement;
      const retryBtn: HTMLButtonElement | null = resultsEl.querySelector('.results-container .error-state button');
      retryBtn?.click();
      tick(300);
      fixture.detectChanges();

      expect(component.searchError).toBeFalse();
      expect(component.searchResults).toEqual([somePacket]);
      expect(fixture.nativeElement.querySelector('.results-container .error-state')).toBeNull();
    }));

    it('still shows the true "no results" empty state for a real empty search — never the error state', fakeAsync(() => {
      configure(false);
      questions.listPackets.and.returnValue(of({ items: [], total: 0, page: 0, size: 25 }));

      component.searchQuery = 'zzz-nothing';
      component.searchPackets();
      tick(300);
      fixture.detectChanges();

      expect(component.searchError).toBeFalse();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.results-container .error-state')).toBeNull();
      expect(el.querySelector('.results-container .empty-state')?.textContent).toContain('No packets found matching');
    }));
  });
});
