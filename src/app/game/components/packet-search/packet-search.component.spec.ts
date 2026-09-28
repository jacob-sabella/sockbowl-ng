import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let dialogClose: jasmine.Spy;
  let snackOpen: jasmine.Spy;
  let questions: Record<string, jasmine.Spy>;

  function configure(permissions: string[], importResult: any = { id: 'p1', name: 'Generated' }): void {
    dialogClose = jasmine.createSpy('close');
    snackOpen = jasmine.createSpy('open');
    questions = {
      getBankTaxonomyCounts: jasmine.createSpy('getBankTaxonomyCounts')
        .and.returnValue(of({ categories: {}, subcategories: {}, alternates: {} })),
      countBankAvailable: jasmine.createSpy('countBankAvailable').and.returnValue(of({ tossups: 0, bonuses: 0 })),
      importQbreaderRandom: jasmine.createSpy('importQbreaderRandom').and.returnValue(
        importResult instanceof Error ? throwError(() => importResult) : of(importResult)),
      // With auth on, a guest's or player's generated packet is EPHEMERAL and
      // getPacketById returns null for it (NG-R3-01).
      getPacketById: jasmine.createSpy('getPacketById').and.returnValue(of(null)),
      getUsedQuestionIds: jasmine.createSpy('getUsedQuestionIds').and.returnValue(of([])),
      recordUsedQuestionIds: jasmine.createSpy('recordUsedQuestionIds').and.returnValue(of(null)),
    };
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.isAuthenticated.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: dialogClose } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: snackOpen } },
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

    // NG-V1-03: 'import-ip' and 'ai-concurrency' are policies the questions
    // backend can also reject these same two actions under, distinct from
    // 'import'/'ai-generate' (plan §2.1) -- a cooldown on either must lock
    // the same button.
    it('also disables Generate while the ai-concurrency policy cools down', () => {
      configure(['question:generate']);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.generateTopic = 'Topic';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-5';
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.generate-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('ai-concurrency', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
    });

    it('also disables Import while the import-ip policy cools down', () => {
      configure([]);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.availTossups = 5;
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.qb-import-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('import-ip', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
    });
  });

  // NG-V1-01: a 403 {error:'banned'}/{error:'ip_banned'} is already surfaced
  // by the global RateLimitInterceptor (plan §2.9); these two flows must not
  // show a second, component-level snackbar for the same rejection.
  describe('NG-V1-01 banned/ip_banned rejections (no double snackbar)', () => {
    it('opens no snackbar when AI generation 403s with {error: "banned"}', () => {
      configure(['question:generate']);
      questions['generatePacket'] = jasmine.createSpy('generatePacket').and.returnValue(
        throwError(() => ({ status: 403, error: { error: 'banned' } }))
      );
      component.generateTopic = 'Topic';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-5';

      component.generateAIPacket();

      expect(snackOpen).not.toHaveBeenCalled();
      expect(component.isGenerating).toBeFalse();
    });

    it('opens no snackbar when import-random 403s with {error: "ip_banned"}', () => {
      configure([]);
      questions['importQbreaderRandom'] = jasmine.createSpy('importQbreaderRandom').and.returnValue(
        throwError(() => ({ status: 403, error: { error: 'ip_banned' } }))
      );

      component.generateFromBank();

      expect(snackOpen).not.toHaveBeenCalled();
      expect(component.qbImporting).toBeFalse();
    });

    it('still shows the generic error for an unrelated 403 (not a ban)', () => {
      configure(['question:generate']);
      questions['generatePacket'] = jasmine.createSpy('generatePacket').and.returnValue(
        throwError(() => ({ status: 403, error: { error: 'forbidden' } }))
      );
      component.generateTopic = 'Topic';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-5';

      component.generateAIPacket();

      expect(snackOpen).toHaveBeenCalled();
    });
  });
});
