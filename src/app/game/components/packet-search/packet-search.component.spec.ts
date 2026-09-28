import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';

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
});
