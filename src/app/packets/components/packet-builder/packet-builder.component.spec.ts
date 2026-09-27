import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { PacketBuilderComponent } from './packet-builder.component';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { GraphqlRequestError } from '../../../core/graphql/graphql-errors';
import { AuthoringPacket } from '../../models/packet-authoring.models';

function makePacket(overrides: Partial<AuthoringPacket> = {}): AuthoringPacket {
  return {
    id: 'p1',
    name: 'Test Packet',
    version: 3,
    visibility: 'DRAFT',
    validation: { playable: true, tossupCount: 2, bonusCount: 1, issues: [] },
    difficulty: { id: 'd1', name: 'Medium' },
    owner: { id: 'user-1', name: 'Me' },
    tossups: [
      { id: 1, order: 0, tossup: { id: 't1', question: 'Q1', answer: 'A1', remoteId: '', subcategory: null as any } },
      { id: 2, order: 1, tossup: { id: 't2', question: 'Q2', answer: 'A2', remoteId: '', subcategory: null as any } }
    ],
    bonuses: [
      {
        id: 1,
        order: 0,
        bonus: {
          id: 'b1',
          preamble: 'P1',
          remoteId: '',
          subcategory: null as any,
          bonusParts: [
            { id: 1, order: 0, bonusPart: { id: 'bp1', question: 'PQ1', answer: 'PA1' } }
          ]
        }
      }
    ],
    ...overrides
  } as AuthoringPacket;
}

describe('PacketBuilderComponent', () => {
  let fixture: ComponentFixture<PacketBuilderComponent>;
  let component: PacketBuilderComponent;
  let questionsSpy: jasmine.SpyObj<SockbowlQuestionsService>;
  let authoringSpy: jasmine.SpyObj<PacketAuthoringService>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let confirmSpy: jasmine.SpyObj<ConfirmDialogService>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;

  function configure(packet: AuthoringPacket, permissions: string[] = ['packet:update', 'packet:delete'], currentUserId: string | null = 'user-1'): void {
    questionsSpy = jasmine.createSpyObj('SockbowlQuestionsService', ['getPacketById']);
    questionsSpy.getPacketById.and.returnValue(of(packet));

    authoringSpy = jasmine.createSpyObj('PacketAuthoringService', [
      'getAllDifficulties', 'getAllCategories', 'getAllSubcategories',
      'renamePacket', 'setPacketDifficulty', 'deletePacket',
      'updateTossup', 'addTossupToPacket', 'removeTossupFromPacket', 'reorderTossup', 'setTossupSubcategory',
      'updateBonus', 'addBonusToPacket', 'removeBonusFromPacket', 'reorderBonus', 'setBonusSubcategory',
      'updateBonusPart', 'addBonusPart', 'removeBonusPart', 'reorderBonusPart',
      'createCategory', 'createSubcategory', 'generateAndAddTossup'
    ]);
    authoringSpy.getAllDifficulties.and.returnValue(of([]));
    authoringSpy.getAllCategories.and.returnValue(of([]));
    authoringSpy.getAllSubcategories.and.returnValue(of([]));

    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'getCurrentUserId']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.getCurrentUserId.and.returnValue(currentUserId);

    confirmSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    confirmSpy.confirm.and.returnValue(of(true));

    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [PacketBuilderComponent],
      providers: [
        { provide: SockbowlQuestionsService, useValue: questionsSpy },
        { provide: PacketAuthoringService, useValue: authoringSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ConfirmDialogService, useValue: confirmSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (key: string) => (key === 'id' ? 'p1' : null) } } } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });

    fixture = TestBed.createComponent(PacketBuilderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('Save all saves only dirty entities, in packet order, and stops at the first error', () => {
    configure(makePacket());

    const callOrder: string[] = [];
    authoringSpy.updateTossup.and.callFake((id) => {
      callOrder.push(`tossup:${id}`);
      return of(id);
    });
    authoringSpy.updateBonus.and.callFake((id) => {
      callOrder.push(`bonus:${id}`);
      return of(id);
    });
    authoringSpy.updateBonusPart.and.callFake((_bonusId, partId) => {
      callOrder.push(`part:${partId}`);
      return of(partId);
    });

    // Dirty the first tossup and the bonus part; leave the second tossup and the bonus itself clean.
    component.tossupDraftStore.get('t1')!.question = 'Edited question';
    component.tossupDraftStore.markDirty('t1');
    component.bonusPartDraftStore.get('bp1')!.answer = 'Edited answer';
    component.bonusPartDraftStore.markDirty('bp1');

    component.saveAll();

    expect(callOrder).toEqual(['tossup:t1', 'part:bp1']);
    expect(authoringSpy.updateTossup).toHaveBeenCalledTimes(1);
    expect(authoringSpy.updateBonus).not.toHaveBeenCalled();
    expect(authoringSpy.updateBonusPart).toHaveBeenCalledTimes(1);
    // Refetches once, at the end, after ngOnInit's own fetch.
    expect(questionsSpy.getPacketById).toHaveBeenCalledTimes(2);
    expect(component.tossupDraftStore.isDirty('t1')).toBeFalse();
    expect(component.bonusPartDraftStore.isDirty('bp1')).toBeFalse();
  });

  it('Save all stops at the first error and leaves the later entity untouched', () => {
    configure(makePacket());

    authoringSpy.updateTossup.and.returnValue(
      throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
    );
    authoringSpy.updateBonusPart.and.returnValue(of('bp1'));

    component.tossupDraftStore.get('t1')!.question = 'Edited';
    component.tossupDraftStore.markDirty('t1');
    component.bonusPartDraftStore.get('bp1')!.answer = 'Edited';
    component.bonusPartDraftStore.markDirty('bp1');

    component.saveAll();

    expect(authoringSpy.updateBonusPart).not.toHaveBeenCalled();
    expect(component.tossupDraftStore.isDirty('t1')).toBeTrue();
    expect(component.bonusPartDraftStore.isDirty('bp1')).toBeTrue();
  });

  it('a CONFLICT response opens the persistent reload banner instead of a snackbar', () => {
    configure(makePacket());
    authoringSpy.updateTossup.and.returnValue(
      throwError(() => new GraphqlRequestError({ message: 'stale', classification: 'CONFLICT', extensions: { currentVersion: 5 } }))
    );

    component.tossupDraftStore.get('t1')!.question = 'Edited';
    component.tossupDraftStore.markDirty('t1');

    component.saveTossup(component.sortedTossups[0]);

    expect(component.conflictBanner).toBeTrue();
    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });

  it('Reload after a conflict refetches, clears the banner, and flags dirty cards as stale', () => {
    configure(makePacket());
    component.conflictBanner = true;
    component.tossupDraftStore.get('t1')!.question = 'Edited';
    component.tossupDraftStore.markDirty('t1');

    const reloaded = makePacket({ version: 4 });
    questionsSpy.getPacketById.and.returnValue(of(reloaded));

    component.reloadAfterConflict();

    expect(component.conflictBanner).toBeFalse();
    expect(component.packetVersion).toBe(4);
    expect(component.isStale('t1')).toBeTrue();
    // The dirty edit itself must survive the reload (PB-02-style guarantee).
    expect(component.tossupDraftStore.get('t1')!.question).toBe('Edited');
  });

  it('sets beforeunload\'s returnValue only when there are unsaved changes', () => {
    configure(makePacket());

    const cleanEvent = { preventDefault: jasmine.createSpy(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    component.onBeforeUnload(cleanEvent);
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled();

    component.tossupDraftStore.get('t1')!.question = 'Edited';
    component.tossupDraftStore.markDirty('t1');

    const dirtyEvent = { preventDefault: jasmine.createSpy(), returnValue: undefined } as unknown as BeforeUnloadEvent;
    component.onBeforeUnload(dirtyEvent);
    expect(dirtyEvent.preventDefault).toHaveBeenCalled();
    expect(dirtyEvent.returnValue).toBeTrue();
  });

  it('hasUnsavedChanges mirrors dirtyCount (backs the D6 canDeactivate guard)', () => {
    configure(makePacket());
    expect(component.hasUnsavedChanges()).toBeFalse();

    component.tossupDraftStore.get('t2')!.answer = 'Edited';
    component.tossupDraftStore.markDirty('t2');

    expect(component.hasUnsavedChanges()).toBeTrue();
  });

  it('the new-bonus form starts with 3 part rows and sends them all on submit', () => {
    configure(makePacket());
    authoringSpy.addBonusToPacket.and.returnValue(of('new-bonus-id'));

    component.openNewBonus();
    expect(component.newBonusDraft.parts.length).toBe(3);

    component.newBonusDraft.preamble = 'A new preamble';
    component.newBonusDraft.parts.forEach((p, i) => {
      p.question = `Part ${i} question`;
      p.answer = `Part ${i} answer`;
    });

    component.submitNewBonus();

    expect(authoringSpy.addBonusToPacket).toHaveBeenCalledTimes(1);
    const [packetId, input] = authoringSpy.addBonusToPacket.calls.mostRecent().args;
    expect(packetId).toBe('p1');
    expect(input.parts?.length).toBe(3);
    expect(input.parts?.[0]).toEqual({ question: 'Part 0 question', answer: 'Part 0 answer' });
  });

  it('does not submit the new-bonus form when any part is missing text', () => {
    configure(makePacket());
    component.openNewBonus();
    component.newBonusDraft.parts[1].question = '';

    component.submitNewBonus();

    expect(authoringSpy.addBonusToPacket).not.toHaveBeenCalled();
    expect(snackBarSpy.open).toHaveBeenCalled();
  });

  it('selecting "None" for a tossup\'s subcategory sends null through the dedicated clear mutation', () => {
    const packet = makePacket();
    packet.tossups[0] = {
      id: 1,
      order: 0,
      tossup: { id: 't1', question: 'Q1', answer: 'A1', remoteId: '', subcategory: { id: 'sub-1', name: 'Sub', category: { id: 'c1', name: 'Cat' } } as any }
    };
    configure(packet);
    authoringSpy.updateTossup.and.returnValue(of('t1'));
    authoringSpy.setTossupSubcategory.and.returnValue(of('t1'));

    expect(component.tossupDraftStore.get('t1')!.subcategoryId).toBe('sub-1');

    component.tossupDraftStore.get('t1')!.subcategoryId = null;
    component.tossupDraftStore.markDirty('t1');

    component.saveTossup(component.sortedTossups[0]);

    expect(authoringSpy.setTossupSubcategory).toHaveBeenCalledWith('t1', null, jasmine.any(Number));
  });

  it('canManagePacket is false for an ownerless packet without packet:manage-any', () => {
    configure(makePacket({ owner: null as any }), []);
    expect(component.canManagePacket).toBeFalse();
  });

  it('canManagePacket is true for an ownerless packet with packet:manage-any', () => {
    configure(makePacket({ owner: null as any }), ['packet:manage-any'], 'someone-else');
    expect(component.canManagePacket).toBeTrue();
  });

  it('canManagePacket is true for the owner', () => {
    configure(makePacket({ owner: { id: 'user-1', name: 'Me' } }), [], 'user-1');
    expect(component.canManagePacket).toBeTrue();
  });

  it('canManagePacket is false for another owned packet', () => {
    configure(makePacket({ owner: { id: 'user-2', name: 'Them' } }), [], 'user-1');
    expect(component.canManagePacket).toBeFalse();
  });
});
