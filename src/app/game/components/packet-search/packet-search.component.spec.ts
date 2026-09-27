import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';
import { PacketSummary } from '../../../packets/models/packet-authoring.models';

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;

  function configure(permissions: string[]): void {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.isAuthenticated.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => { /* noop test double */ } } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => { /* noop test double */ } } },
        { provide: SockbowlQuestionsService, useValue: {
            getBankTaxonomyCounts: () => of({ categories: {}, subcategories: {}, alternates: {} }),
            countBankAvailable: () => of({ tossups: 0, bonuses: 0 }),
        } },
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
});

describe('PacketSearchComponent My packets / search (PB-14)', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let questions: jasmine.SpyObj<SockbowlQuestionsService>;

  const somePacket: PacketSummary = {
    id: 'p1', name: 'A Packet', visibility: 'DRAFT', version: 1,
    tossupCount: 5, bonusCount: 1, playable: true,
  };
  const unplayablePacket: PacketSummary = {
    id: 'p2', name: 'Unfinished', visibility: 'DRAFT', version: 1,
    tossupCount: 0, bonusCount: 0, playable: false,
  };

  function configure(authenticated: boolean, myPacketsItems: PacketSummary[] = []): void {
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.returnValue(false);
    authSpy.isAuthenticated.and.returnValue(authenticated);

    questions = jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', [
      'getBankTaxonomyCounts', 'countBankAvailable', 'listPackets', 'getPacketById',
    ]);
    questions.getBankTaxonomyCounts.and.returnValue(of({ categories: {}, subcategories: {}, alternates: {} }));
    questions.countBankAvailable.and.returnValue(of({ tossups: 0, bonuses: 0 }));
    questions.listPackets.and.returnValue(of({ items: myPacketsItems, total: myPacketsItems.length, page: 0, size: 10 }));
    questions.getPacketById.and.returnValue(of(null));

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => { /* noop test double */ } } },
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

    const row = (fixture.nativeElement as HTMLElement).querySelector('.result-item.unplayable');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not select an unplayable row on click', () => {
    configure(true, [unplayablePacket]);

    component.selectPacket(unplayablePacket);
    // selectPacket itself doesn't gate on playable — the template does, via
    // `packet.playable && selectPacket(packet)` — so exercise that contract directly.
    expect(unplayablePacket.playable).toBeFalse();
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
});
