import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Subject, of, throwError } from 'rxjs';

import { PacketBuilderComponent } from './packet-builder.component';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { PendingPacketService } from '../../../game/services/pending-packet.service';
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
  let routerSpy: jasmine.SpyObj<Router>;
  let pendingPacketSpy: jasmine.SpyObj<PendingPacketService>;
  let liveAnnouncerSpy: jasmine.SpyObj<LiveAnnouncer>;

  function configure(
    packet: AuthoringPacket,
    permissions: string[] = ['packet:update', 'packet:delete'],
    currentUserId: string | null = 'user-1',
    confirmResult = true
  ): void {
    questionsSpy = jasmine.createSpyObj('SockbowlQuestionsService', ['getPacketById', 'exportPacket']);
    questionsSpy.getPacketById.and.returnValue(of(packet));

    authoringSpy = jasmine.createSpyObj('PacketAuthoringService', [
      'getAllDifficulties', 'getAllCategories', 'getAllSubcategories',
      'renamePacket', 'setPacketDifficulty', 'deletePacket',
      'updateTossup', 'addTossupToPacket', 'removeTossupFromPacket', 'reorderTossup', 'setTossupSubcategory',
      'updateBonus', 'addBonusToPacket', 'removeBonusFromPacket', 'reorderBonus', 'setBonusSubcategory',
      'updateBonusPart', 'addBonusPart', 'removeBonusPart', 'reorderBonusPart',
      'createCategory', 'createSubcategory', 'generateAndAddTossup',
      'setPacketVisibility', 'clonePacket'
    ]);
    authoringSpy.getAllDifficulties.and.returnValue(of([]));
    authoringSpy.getAllCategories.and.returnValue(of([]));
    authoringSpy.getAllSubcategories.and.returnValue(of([]));

    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'getCurrentUserId']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.getCurrentUserId.and.returnValue(currentUserId);

    confirmSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    confirmSpy.confirm.and.returnValue(of(confirmResult));

    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    routerSpy = jasmine.createSpyObj('Router', ['navigate']);
    pendingPacketSpy = jasmine.createSpyObj('PendingPacketService', ['set', 'get', 'clear']);
    liveAnnouncerSpy = jasmine.createSpyObj('LiveAnnouncer', ['announce']);
    liveAnnouncerSpy.announce.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      declarations: [PacketBuilderComponent],
      imports: [MatMenuModule],
      providers: [
        { provide: SockbowlQuestionsService, useValue: questionsSpy },
        { provide: PacketAuthoringService, useValue: authoringSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ConfirmDialogService, useValue: confirmSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
        { provide: Router, useValue: routerSpy },
        { provide: PendingPacketService, useValue: pendingPacketSpy },
        { provide: LiveAnnouncer, useValue: liveAnnouncerSpy },
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
      tossup: { id: 't1', question: 'Q1', answer: 'A1', remoteId: '', subcategory: { id: 'sub-1', name: 'Sub', category: { id: 'c1', name: 'Cat' } } } as any
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

  // NG-R2-04 (M2): a non-owner's read redacts owner.id to null (D2's
  // answer-free projection) rather than nulling out `owner` entirely.
  it('canManagePacket is true for packet:manage-any on a redacted owner.id:null packet (NG-R2-04)', () => {
    configure(makePacket({ owner: { id: null, name: null } as any }), ['packet:manage-any'], 'someone-else');
    expect(component.canManagePacket).toBeTrue();
  });

  it('canManagePacket is false for a redacted owner.id:null packet while the current user id has not resolved yet (NG-R2-04)', () => {
    // Before AuthService's ID-token profile has loaded, getCurrentUserId()
    // can also be null. A naive `owner.id === userId` would wrongly treat
    // that as a match; canManagePacket must require a real, non-null id.
    configure(makePacket({ owner: { id: null, name: null } as any }), [], null);
    expect(component.canManagePacket).toBeFalse();
  });

  describe('bumpLocalVersion on every mutation success path (NG-V1-04)', () => {
    // Every one of these left `packetVersion` one behind the server between
    // its own mutation succeeding and the async refetch() landing, so a
    // second, unrelated mutation fired in that window sent a stale
    // expectedVersion and got a spurious CONFLICT for the user's own edit.
    it('removeTossup bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.removeTossupFromPacket.and.returnValue(of('t1'));

      component.removeTossup(component.sortedTossups[0]);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('moveTossup (keyboard reorder) bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.reorderTossup.and.returnValue(of('t1'));

      component.moveTossup(component.sortedTossups[0], 1);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('addTossup bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.addTossupToPacket.and.returnValue(of('new-tossup-id'));
      component.openNewTossup();
      component.newTossupDraft = { question: 'Q', answer: 'A', subcategoryId: null };

      component.addTossup();

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('generateTossup (AI-assist) bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.generateAndAddTossup.and.returnValue(of('new-tossup-id'));
      component.openGenerate();
      component.genDraft = { topic: 'topic', additionalContext: '', subcategoryId: null, apiKey: 'key', model: '' };

      component.generateTossup();

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('removeBonus bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.removeBonusFromPacket.and.returnValue(of('b1'));

      component.removeBonus(component.sortedBonuses[0]);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('moveBonus (keyboard reorder) bumps the local version on success', () => {
      configure(makePacket({
        bonuses: [
          { id: 1, order: 0, bonus: { id: 'b1', preamble: 'P1', remoteId: '', subcategory: null as any, bonusParts: [] } },
          { id: 2, order: 1, bonus: { id: 'b2', preamble: 'P2', remoteId: '', subcategory: null as any, bonusParts: [] } }
        ]
      } as any));
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.reorderBonus.and.returnValue(of('b1'));

      component.moveBonus(component.sortedBonuses[0], 1);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('submitNewBonus bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.addBonusToPacket.and.returnValue(of('new-bonus-id'));
      component.openNewBonus();
      component.newBonusDraft.parts = component.newBonusDraft.parts.map(() => ({ question: 'Q', answer: 'A' }));

      component.submitNewBonus();

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('removePart bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.removeBonusPart.and.returnValue(of('bp1'));
      const be = component.sortedBonuses[0];

      component.removePart(be, component.sortedParts(be)[0]);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('movePart (keyboard reorder) bumps the local version on success', () => {
      configure(makePacket({
        bonuses: [
          {
            id: 1,
            order: 0,
            bonus: {
              id: 'b1', preamble: 'P1', remoteId: '', subcategory: null as any,
              bonusParts: [
                { id: 1, order: 0, bonusPart: { id: 'bp1', question: 'PQ1', answer: 'PA1' } },
                { id: 2, order: 1, bonusPart: { id: 'bp2', question: 'PQ2', answer: 'PA2' } }
              ]
            }
          }
        ]
      } as any));
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.reorderBonusPart.and.returnValue(of('bp1'));
      const be = component.sortedBonuses[0];

      component.movePart(be, component.sortedParts(be)[0], 1);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('addPart bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.addBonusPart.and.returnValue(of('new-part-id'));
      const be = component.sortedBonuses[0];
      component.openNewPart(be);
      component.newPartDrafts[be.bonus.id] = { question: 'Q', answer: 'A' };

      component.addPart(be);

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('saveName (rename) bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.renamePacket.and.returnValue(of('p1'));
      component.startEditName();
      component.nameDraft = 'New Name';

      component.saveName();

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });

    it('onDifficultyChange bumps the local version on success', () => {
      configure(makePacket());
      spyOn<any>(component, 'bumpLocalVersion').and.callThrough();
      authoringSpy.setPacketDifficulty.and.returnValue(of('p1'));

      component.onDifficultyChange('d2');

      expect(component['bumpLocalVersion']).toHaveBeenCalled();
    });
  });

  describe('drag-and-drop reorder (PB-20)', () => {
    it('a tossup drop renumbers locally and calls reorderTossup once with the target index', () => {
      configure(makePacket());
      authoringSpy.reorderTossup.and.returnValue(of('t1'));

      component.dropTossup({ previousIndex: 0, currentIndex: 1 } as any);

      expect(authoringSpy.reorderTossup).toHaveBeenCalledTimes(1);
      expect(authoringSpy.reorderTossup).toHaveBeenCalledWith('p1', 't1', 1, jasmine.any(Number));
      expect(component.sortedTossups[0].tossup.id).toBe('t2');
      expect(component.sortedTossups[1].tossup.id).toBe('t1');
    });

    it('a failed tossup drop rolls back to the original order', () => {
      configure(makePacket());
      authoringSpy.reorderTossup.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );

      component.dropTossup({ previousIndex: 0, currentIndex: 1 } as any);

      expect(component.sortedTossups[0].tossup.id).toBe('t1');
      expect(component.sortedTossups[1].tossup.id).toBe('t2');
      expect(snackBarSpy.open).toHaveBeenCalled();
    });

    it('a no-op drop (same index) does not call reorderTossup', () => {
      configure(makePacket());
      component.dropTossup({ previousIndex: 0, currentIndex: 0 } as any);
      expect(authoringSpy.reorderTossup).not.toHaveBeenCalled();
    });

    it('a bonus drop calls reorderBonus once with the target index; an error rolls back', () => {
      const packet = makePacket();
      packet.bonuses.push({
        id: 2,
        order: 1,
        bonus: { id: 'b2', preamble: 'P2', remoteId: '', subcategory: null as any, bonusParts: [] }
      } as any);
      configure(packet);
      authoringSpy.reorderBonus.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );

      component.dropBonus({ previousIndex: 0, currentIndex: 1 } as any);

      expect(authoringSpy.reorderBonus).toHaveBeenCalledWith('p1', 'b1', 1, jasmine.any(Number));
      // Rolled back: b1 is order 0 again.
      expect(component.sortedBonuses[0].bonus.id).toBe('b1');
    });

    it('a bonus-part drop calls reorderBonusPart once with the target index', () => {
      const packet = makePacket();
      packet.bonuses[0].bonus.bonusParts!.push({
        id: 2,
        order: 1,
        bonusPart: { id: 'bp2', question: 'PQ2', answer: 'PA2' }
      } as any);
      configure(packet);
      authoringSpy.reorderBonusPart.and.returnValue(of('bp1'));

      const be = component.sortedBonuses[0];
      component.dropPart(be, { previousIndex: 0, currentIndex: 1 } as any);

      expect(authoringSpy.reorderBonusPart).toHaveBeenCalledWith('b1', 'bp1', 1, jasmine.any(Number));
      expect(component.sortedParts(be)[0].bonusPart.id).toBe('bp2');
      expect(component.sortedParts(be)[1].bonusPart.id).toBe('bp1');
    });
  });

  describe('AI-assist generate (PB-08)', () => {
    it('sends the apiKey/model the AiKeyPickerComponent bound into genDraft', () => {
      configure(makePacket());
      authoringSpy.generateAndAddTossup.and.returnValue(of('new-tossup-id'));

      component.openGenerate();
      component.genDraft.topic = 'Ancient Rome';
      // Simulates AiKeyPickerComponent's (apiKeyChange)/(modelChange) outputs.
      component.genDraft.apiKey = 'sk-test-key';
      component.genDraft.model = 'gpt-4o';

      component.generateTossup();

      expect(authoringSpy.generateAndAddTossup).toHaveBeenCalledTimes(1);
      const [packetId, input] = authoringSpy.generateAndAddTossup.calls.mostRecent().args;
      expect(packetId).toBe('p1');
      expect(input.apiKey).toBe('sk-test-key');
      expect(input.model).toBe('gpt-4o');
    });

    it('refuses to submit without an API key', () => {
      configure(makePacket());
      component.openGenerate();
      component.genDraft.topic = 'Ancient Rome';

      component.generateTossup();

      expect(authoringSpy.generateAndAddTossup).not.toHaveBeenCalled();
      expect(snackBarSpy.open).toHaveBeenCalled();
    });
  });

  describe('publish toggle (plan 3.3.3)', () => {
    it('publishing a playable packet does not ask for confirmation', () => {
      configure(makePacket({ visibility: 'DRAFT', validation: { playable: true, tossupCount: 2, bonusCount: 1, issues: [] } }));
      authoringSpy.setPacketVisibility.and.returnValue(of('p1'));

      component.setVisibility('PUBLISHED');

      expect(confirmSpy.confirm).not.toHaveBeenCalled();
      expect(authoringSpy.setPacketVisibility).toHaveBeenCalledWith('p1', 'PUBLISHED', jasmine.any(Number));
    });

    it('publishing an unplayable packet confirms first and lists the ERRORs', () => {
      configure(makePacket({
        visibility: 'DRAFT',
        validation: { playable: false, tossupCount: 0, bonusCount: 0, issues: [{ severity: 'ERROR', code: 'NO_TOSSUPS', message: 'Packet has no tossups' }] }
      }));
      authoringSpy.setPacketVisibility.and.returnValue(of('p1'));

      component.setVisibility('PUBLISHED');

      expect(confirmSpy.confirm).toHaveBeenCalled();
      expect(authoringSpy.setPacketVisibility).toHaveBeenCalledWith('p1', 'PUBLISHED', jasmine.any(Number));
    });

    it('declining the confirmation does not publish', () => {
      configure(
        makePacket({
          visibility: 'DRAFT',
          validation: { playable: false, tossupCount: 0, bonusCount: 0, issues: [{ severity: 'ERROR', code: 'NO_TOSSUPS', message: 'Packet has no tossups' }] }
        }),
        ['packet:update', 'packet:delete'],
        'user-1',
        false
      );

      component.setVisibility('PUBLISHED');

      expect(confirmSpy.confirm).toHaveBeenCalled();
      expect(authoringSpy.setPacketVisibility).not.toHaveBeenCalled();
    });

    it('un-publishing never asks for confirmation, even when unplayable', () => {
      configure(makePacket({
        visibility: 'PUBLISHED',
        validation: { playable: false, tossupCount: 0, bonusCount: 0, issues: [] }
      }));
      authoringSpy.setPacketVisibility.and.returnValue(of('p1'));

      component.setVisibility('DRAFT');

      expect(confirmSpy.confirm).not.toHaveBeenCalled();
      expect(authoringSpy.setPacketVisibility).toHaveBeenCalledWith('p1', 'DRAFT', jasmine.any(Number));
    });
  });

  describe('duplicate, export, and play test', () => {
    it('Duplicate calls clonePacket and navigates to the new builder', () => {
      configure(makePacket());
      authoringSpy.clonePacket.and.returnValue(of('new-packet-id'));

      component.duplicatePacket();

      expect(authoringSpy.clonePacket).toHaveBeenCalledWith('p1');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/packets', 'new-packet-id', 'edit']);
    });

    it('exporting plaintext calls exportPacket and triggers a Blob download', () => {
      configure(makePacket());
      questionsSpy.exportPacket.and.returnValue(of('1. Some question\nANSWER: Some answer\n'));
      const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake-url');
      const revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLAnchorElement.prototype, 'click'); // avoid a real navigation attempt in the test browser

      component.exportPlaintext();

      expect(questionsSpy.exportPacket).toHaveBeenCalledWith('p1');
      expect(createObjectURLSpy).toHaveBeenCalled();
      expect(revokeObjectURLSpy).toHaveBeenCalled();
    });

    it('exporting JSON downloads the current packet without another fetch', () => {
      configure(makePacket());
      const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake-url');
      spyOn(URL, 'revokeObjectURL');
      spyOn(HTMLAnchorElement.prototype, 'click');

      component.exportJson();

      expect(createObjectURLSpy).toHaveBeenCalled();
      // ngOnInit's own fetch only; JSON export reuses the already-loaded packet.
      expect(questionsSpy.getPacketById).toHaveBeenCalledTimes(1);
    });

    it('Play test navigates to /game-session with the mode/packetId query params', () => {
      configure(makePacket());

      component.playTest();

      expect(routerSpy.navigate).toHaveBeenCalledWith(['/game-session'], { queryParams: { mode: 'single', packetId: 'p1' } });
    });

    it(
      'Play test does NOT pre-set the pending packet in sessionStorage (NG-V1-05): ' +
        'GameSessionComponent sets it from the query param it just navigated with, so a second, ' +
        'earlier write here is the one that goes stale if navigation is cancelled or the solo game fails',
      () => {
        configure(makePacket());

        component.playTest();

        expect(pendingPacketSpy.set).not.toHaveBeenCalled();
      },
    );
  });

  describe('print (NG-V1-01: the printout must include the bonuses)', () => {
    it('printPacket shows the preview and renders a print-only linear reading view alongside the on-screen tabbed one', () => {
      configure(makePacket());

      component.printPacket();
      fixture.detectChanges();

      expect(component.showPreview).toBeTrue();
      const readingViews = fixture.nativeElement.querySelectorAll('app-packet-reading-view');
      // One interactive, tabbed instance for on-screen viewing, and one
      // print-only linear instance that always has both sections in the DOM
      // — see packet-reading-view.component's own spec for the linear-mode
      // behavior, and _print.scss for which one @media print shows.
      expect(readingViews.length).toBe(2);
      expect(fixture.nativeElement.querySelector('app-packet-reading-view.packet-builder__preview-onscreen')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('app-packet-reading-view.packet-builder__preview-print-only')).not.toBeNull();
    });

    it('does not render the print-only reading view outside of preview mode', () => {
      configure(makePacket());
      expect(component.showPreview).toBeFalse();
      expect(fixture.nativeElement.querySelector('app-packet-reading-view')).toBeNull();
    });
  });

  describe('D7 empty-preamble note (NG-V1-03: a warning, not a mat-error)', () => {
    it("renders the D7 note as a mat-hint, never a mat-error, for a bonus with an empty preamble", () => {
      const packet = makePacket({
        bonuses: [
          {
            id: 1,
            order: 0,
            bonus: { id: 'b1', preamble: '', remoteId: '', subcategory: null as any, bonusParts: [] }
          }
        ]
      } as any);
      configure(packet);

      const html: string = fixture.nativeElement.innerHTML;
      expect(html).toContain('An empty preamble is allowed, but not recommended');
      // Structurally a hint, not an error: an empty preamble is valid by
      // design (D7), so it must never gate Save or look like a failure.
      const warningHint = fixture.nativeElement.querySelector('.packet-builder__field-warning-hint');
      expect(warningHint).not.toBeNull();
      expect(warningHint.tagName.toLowerCase()).toBe('mat-hint');
      expect(fixture.nativeElement.querySelector('mat-error')).toBeNull();
    });
  });

  describe('read-only view for a non-manager (NG-V1-07)', () => {
    // A non-manager reaches /packets/:id/edit only because the route guard is
    // gated on packet:update alone (app-routing.module.ts), not on ownership
    // -- so it's entirely possible to land here with canManagePacket false.
    // Before this fix, the textareas, drag handles and Save all bar were
    // still live, so typing (or dragging) marked the page dirty and any
    // attempt to save failed server-side with FORBIDDEN.
    function configureAsNonManager(): void {
      // No packet:update/packet:delete, and not the owner: canManagePacket must be false.
      configure(makePacket({ owner: { id: 'user-2', name: 'Them' } }), [], 'user-1');
      expect(component.canManagePacket).toBeFalse();
    }

    it('marks the tossup Question and Answer textareas readonly', () => {
      configureAsNonManager();
      const panel = fixture.nativeElement.querySelectorAll('.packet-builder__tossups textarea');
      expect(panel.length).toBeGreaterThan(0);
      panel.forEach((ta: HTMLTextAreaElement) => expect(ta.readOnly).toBeTrue());
    });

    it('marks the bonus preamble and bonus part Question/Answer textareas readonly', () => {
      configureAsNonManager();
      const areas = fixture.nativeElement.querySelectorAll('.packet-builder__bonuses textarea');
      expect(areas.length).toBeGreaterThan(0);
      areas.forEach((ta: HTMLTextAreaElement) => expect(ta.readOnly).toBeTrue());
    });

    it('hides the unsaved-changes / Save all bar entirely', () => {
      configureAsNonManager();
      expect(fixture.nativeElement.querySelector('.packet-builder__save-bar')).toBeNull();
    });

    it('shows editable textareas and the unsaved bar for a manager (control)', () => {
      configure(makePacket());
      expect(component.canManagePacket).toBeTrue();
      const areas: HTMLTextAreaElement[] = Array.from(fixture.nativeElement.querySelectorAll('textarea'));
      expect(areas.length).toBeGreaterThan(0);
      areas.forEach((ta) => expect(ta.readOnly).toBeFalse());
      expect(fixture.nativeElement.querySelector('.packet-builder__save-bar')).not.toBeNull();
    });
  });

  describe('S4-05: per-card Save busy state and double-submit guard', () => {
    it('a second click on tossup Save while the first is in flight issues no second mutation', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateTossup.and.returnValue(subject.asObservable());
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');
      const te = component.sortedTossups[0];

      component.saveTossup(te);
      component.saveTossup(te);

      expect(authoringSpy.updateTossup).toHaveBeenCalledTimes(1);
      expect(component.isSavingTossup('t1')).toBeTrue();

      subject.next('t1');
      subject.complete();
      expect(component.isSavingTossup('t1')).toBeFalse();
    });

    it('the tossup card Save button shows a busy label and aria-busy while saving', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateTossup.and.returnValue(subject.asObservable());
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');

      component.saveTossup(component.sortedTossups[0]);
      fixture.detectChanges();

      const saveBtn = fixture.nativeElement.querySelector('.packet-builder__tossups .packet-builder__card-save-btn') as HTMLButtonElement;
      expect(saveBtn.getAttribute('aria-busy')).toBe('true');
      expect(saveBtn.disabled).toBeTrue();
      expect(saveBtn.textContent).toContain('Saving');
    });

    it('a second click on bonus Save while the first is in flight issues no second mutation', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateBonus.and.returnValue(subject.asObservable());
      component.bonusDraftStore.get('b1')!.preamble = 'Edited';
      component.bonusDraftStore.markDirty('b1');
      const be = component.sortedBonuses[0];

      component.saveBonus(be);
      component.saveBonus(be);

      expect(authoringSpy.updateBonus).toHaveBeenCalledTimes(1);
      subject.next('b1');
      subject.complete();
    });

    it('a second click on bonus-part Save while the first is in flight issues no second mutation', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateBonusPart.and.returnValue(subject.asObservable());
      component.bonusPartDraftStore.get('bp1')!.answer = 'Edited';
      component.bonusPartDraftStore.markDirty('bp1');
      const be = component.sortedBonuses[0];
      const pe = component.sortedParts(be)[0];

      component.savePart(be, pe);
      component.savePart(be, pe);

      expect(authoringSpy.updateBonusPart).toHaveBeenCalledTimes(1);
      subject.next('bp1');
      subject.complete();
    });

    it('a second click on Save name while the first is in flight issues no second mutation', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.renamePacket.and.returnValue(subject.asObservable());
      component.startEditName();
      component.nameDraft = 'New Name';

      component.saveName();
      component.saveName();

      expect(authoringSpy.renamePacket).toHaveBeenCalledTimes(1);
      subject.next('p1');
      subject.complete();
    });
  });

  describe('S4-06: Save all progress, error targeting, and the graphql-write limit', () => {
    it('reports "Saving N of M" while in flight and clears when done', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateTossup.and.returnValue(subject.asObservable());
      authoringSpy.updateBonusPart.and.returnValue(of('bp1'));

      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');
      component.bonusPartDraftStore.get('bp1')!.answer = 'Edited';
      component.bonusPartDraftStore.markDirty('bp1');

      component.saveAll();

      expect(component.savingAll).toBeTrue();
      expect(component.saveAllCurrent).toBe(1);
      expect(component.saveAllTotal).toBe(2);

      subject.next('t1');
      subject.complete();

      expect(component.savingAll).toBeFalse();
      expect(component.saveAllTotal).toBe(0);
      expect(component.saveAllCurrent).toBe(0);
    });

    it('the sticky save bar shows "Saving N of M…" while Save all is running', () => {
      configure(makePacket());
      const subject = new Subject<string>();
      authoringSpy.updateTossup.and.returnValue(subject.asObservable());
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');

      component.saveAll();
      fixture.detectChanges();

      const bar = fixture.nativeElement.querySelector('.packet-builder__save-bar');
      expect(bar.textContent).toContain('Saving 1 of 1');
    });

    it('a failure expands, scrolls to, and renders the error inline on the failing card; remaining dirty cards stay dirty', () => {
      configure(makePacket());
      authoringSpy.updateTossup.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'That change is not valid.', classification: 'VALIDATION_FAILED' }))
      );
      authoringSpy.updateBonusPart.and.returnValue(of('bp1'));

      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');
      component.bonusPartDraftStore.get('bp1')!.answer = 'Edited';
      component.bonusPartDraftStore.markDirty('bp1');

      component.saveAll();

      expect(component.expandedTossupId).toBe('t1');
      expect(component.entitySaveErrors['t1']).toContain('not valid');
      expect(component.savingAll).toBeFalse();
      expect(component.tossupDraftStore.isDirty('t1')).toBeTrue();
      expect(component.bonusPartDraftStore.isDirty('bp1')).toBeTrue();
      expect(authoringSpy.updateBonusPart).not.toHaveBeenCalled();
    });

    it('a failure on a bonus part expands its parent bonus panel and targets the part', () => {
      configure(makePacket());
      authoringSpy.updateBonusPart.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );
      component.bonusPartDraftStore.get('bp1')!.answer = 'Edited';
      component.bonusPartDraftStore.markDirty('bp1');

      component.saveAll();

      expect(component.expandedBonusId).toBe('b1');
      expect(component.entitySaveErrors['bp1']).toBeDefined();
    });

    it('a RATE_LIMITED failure shows exactly one snackbar, via notifyLimit', () => {
      configure(makePacket());
      authoringSpy.updateTossup.and.returnValue(
        throwError(() => new GraphqlRequestError({
          message: 'slow down',
          classification: 'RATE_LIMITED',
          extensions: { retryAfterSeconds: 5 }
        }))
      );
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');

      component.saveAll();

      expect(snackBarSpy.open).toHaveBeenCalledTimes(1);
      expect(snackBarSpy.open.calls.mostRecent().args[0]).toContain('try again');
    });

    it('a QUOTA_EXCEEDED failure shows exactly one snackbar, via notifyLimit', () => {
      configure(makePacket());
      authoringSpy.updateTossup.and.returnValue(
        throwError(() => new GraphqlRequestError({
          message: 'quota',
          classification: 'QUOTA_EXCEEDED',
          extensions: { metric: 'packet-writes', limit: 100 }
        }))
      );
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');

      component.saveAll();

      expect(snackBarSpy.open).toHaveBeenCalledTimes(1);
      expect(snackBarSpy.open.calls.mostRecent().args[0]).toContain('limit');
    });

    it('a BANNED mutation failure (any mutation, not just Save all) routes through notifyLimit for one snackbar', () => {
      configure(makePacket());
      authoringSpy.setPacketVisibility.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'banned', classification: 'BANNED', extensions: { reason: 'Spam' } }))
      );

      component.setVisibility('PUBLISHED');

      expect(snackBarSpy.open).toHaveBeenCalledTimes(1);
      expect(snackBarSpy.open.calls.mostRecent().args[0]).toBe('Spam');
    });
  });

  describe('S4-13: initial load per-class states (404/403/network) and Retry', () => {
    it('a NOT_FOUND load failure renders the not-found state with no snackbar', () => {
      configure(makePacket());
      snackBarSpy.open.calls.reset();
      questionsSpy.getPacketById.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'nope', classification: 'NOT_FOUND' }))
      );

      component.retryLoad();

      expect(component.loadError).toEqual({ kind: 'not-found', message: "This packet doesn't exist or was deleted" });
      expect(snackBarSpy.open).not.toHaveBeenCalled();
    });

    it('a FORBIDDEN load failure renders the forbidden state', () => {
      configure(makePacket());
      questionsSpy.getPacketById.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'nope', classification: 'FORBIDDEN' }))
      );

      component.retryLoad();

      expect(component.loadError?.kind).toBe('forbidden');
    });

    it('a network/500 load failure renders the network state, and Retry reloads successfully', () => {
      configure(makePacket());
      questionsSpy.getPacketById.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );

      component.retryLoad();
      expect(component.loadError?.kind).toBe('network');

      questionsSpy.getPacketById.and.returnValue(of(makePacket()));
      component.retryLoad();

      expect(component.loadError).toBeNull();
      expect(component.packet).not.toBeNull();
    });

    it('renders the loading label, and on a network failure the message and a Retry button', () => {
      configure(makePacket());
      questionsSpy.getPacketById.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );

      component.retryLoad();
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain("Couldn't load this packet");
      expect(fixture.nativeElement.querySelector('.packet-builder__state-actions button')).not.toBeNull();
    });
  });

  describe('S4-15: conflict draft count, and admin owner context', () => {
    it('the conflict banner states how many unsaved changes will be kept on Reload', () => {
      configure(makePacket());
      component.tossupDraftStore.get('t1')!.question = 'Edited';
      component.tossupDraftStore.markDirty('t1');
      component.conflictBanner = true;
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('1 unsaved change');
      expect(text).toContain('kept on Reload');
    });

    it('ownerDisplayName is null for the owner themself', () => {
      configure(makePacket({ owner: { id: 'user-1', name: 'Me' } }), [], 'user-1');
      expect(component.ownerDisplayName).toBeNull();
    });

    it('ownerDisplayName names the owner for an admin viewing someone else\'s packet', () => {
      configure(makePacket({ owner: { id: 'user-2', name: 'Alex Owner' } }), ['packet:manage-any'], 'user-1');
      expect(component.ownerDisplayName).toBe('Alex Owner');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Owned by Alex Owner');
    });

    it('the delete confirmation names the owner when an admin deletes someone else\'s packet', () => {
      configure(makePacket({ owner: { id: 'user-2', name: 'Alex Owner' } }), ['packet:manage-any', 'packet:delete'], 'user-1');
      authoringSpy.deletePacket.and.returnValue(of(true));

      component.deletePacket();

      const confirmArg = confirmSpy.confirm.calls.mostRecent().args[0];
      expect(confirmArg.message).toContain('Alex Owner');
    });
  });

  describe('S4-16: reorder refuses to start while any save is in flight', () => {
    it('a tossup drop is ignored while another card\'s Save is in flight', () => {
      configure(makePacket());
      component.savingTossupIds.add('t2');

      component.dropTossup({ previousIndex: 0, currentIndex: 1 } as any);

      expect(authoringSpy.reorderTossup).not.toHaveBeenCalled();
    });

    it('a bonus-part drop is ignored while Save all is running', () => {
      const packet = makePacket();
      packet.bonuses[0].bonus.bonusParts!.push({
        id: 2,
        order: 1,
        bonusPart: { id: 'bp2', question: 'PQ2', answer: 'PA2' }
      } as any);
      configure(packet);
      component.savingAll = true;

      component.dropPart(component.sortedBonuses[0], { previousIndex: 0, currentIndex: 1 } as any);

      expect(authoringSpy.reorderBonusPart).not.toHaveBeenCalled();
    });

    it('drag handles carry a touch start delay so scrolling a long list never starts a drag', () => {
      configure(makePacket());
      const handle = fixture.nativeElement.querySelector('.packet-builder__tossups [cdkDrag]');
      expect(handle).not.toBeNull();
    });
  });

  describe('S4-19: keyboard-reachable reorder', () => {
    it('the collapsed tossup header exposes a focusable Move up / Move down pair, not just the drag handle', () => {
      configure(makePacket());
      const up = fixture.nativeElement.querySelector('.packet-builder__tossups .packet-builder__reorder-btn[aria-label="Move tossup 1 up"]');
      const down = fixture.nativeElement.querySelector('.packet-builder__tossups .packet-builder__reorder-btn[aria-label="Move tossup 1 down"]');
      expect(up).not.toBeNull();
      expect(down).not.toBeNull();
      expect(up.tagName.toLowerCase()).toBe('button');
    });

    it('the first item\'s Move up and the last item\'s Move down are disabled', () => {
      configure(makePacket());
      const up = fixture.nativeElement.querySelector('.packet-builder__reorder-btn[aria-label="Move tossup 1 up"]');
      const down = fixture.nativeElement.querySelector('.packet-builder__reorder-btn[aria-label="Move tossup 2 down"]');
      expect(up.disabled).toBeTrue();
      expect(down.disabled).toBeTrue();
    });

    it('moveTossup is ignored while any save is in flight', () => {
      configure(makePacket());
      component.savingTossupIds.add('t2');

      component.moveTossup(component.sortedTossups[0], 1);

      expect(authoringSpy.reorderTossup).not.toHaveBeenCalled();
    });

    it('moveTossup announces the new position on success', () => {
      configure(makePacket());
      authoringSpy.reorderTossup.and.returnValue(of('t1'));

      component.moveTossup(component.sortedTossups[0], 1);

      expect(liveAnnouncerSpy.announce).toHaveBeenCalledWith('Tossup 1 moved to position 2', 'polite');
    });

    it('moveBonus is ignored while Save all is running', () => {
      configure(makePacket());
      component.savingAll = true;

      component.moveBonus(component.sortedBonuses[0], 1);

      expect(authoringSpy.reorderBonus).not.toHaveBeenCalled();
    });

    it('moveBonus announces the new position on success', () => {
      configure(makePacket({
        bonuses: [
          { id: 1, order: 0, bonus: { id: 'b1', preamble: 'P1', remoteId: '', subcategory: null as any, bonusParts: [] } },
          { id: 2, order: 1, bonus: { id: 'b2', preamble: 'P2', remoteId: '', subcategory: null as any, bonusParts: [] } }
        ]
      } as any));
      authoringSpy.reorderBonus.and.returnValue(of('b1'));

      component.moveBonus(component.sortedBonuses[0], 1);

      expect(liveAnnouncerSpy.announce).toHaveBeenCalledWith('Bonus 1 moved to position 2', 'polite');
    });
  });

  describe('S4-18: heading order', () => {
    it('the Tossups and Bonuses sections are real h2 headings under the packet name h1, not a skipped h1 -> h4', () => {
      configure(makePacket());
      const h1 = fixture.nativeElement.querySelectorAll('h1');
      const h2 = Array.from(fixture.nativeElement.querySelectorAll('h2')).map((el: any) => el.textContent.trim());

      expect(h1.length).toBe(1);
      expect(h2).toContain('Tossups');
      expect(h2).toContain('Bonuses');
    });

    it('the readiness line is a polite live region', () => {
      configure(makePacket());
      const validation = fixture.nativeElement.querySelector('.packet-builder__validation');
      expect(validation.getAttribute('role')).toBe('status');
    });
  });

  describe('S4-17: the "New subcategory" overlay behaves like a dialog', () => {
    it('is marked up as a modal dialog labelled by its own heading', () => {
      configure(makePacket());
      component.openTaxonomyForm(() => undefined);
      fixture.detectChanges();

      const dialog = fixture.nativeElement.querySelector('.packet-builder__taxonomy-card');
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('taxonomy-dialog-title');

      const title = fixture.nativeElement.querySelector('#taxonomy-dialog-title');
      expect(title.tagName.toLowerCase()).toBe('h2');
      expect(title.textContent).toContain('New subcategory');
    });

    it('captures the triggering element on open and returns focus to it once closed', fakeAsync(() => {
      configure(makePacket());
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      component.openTaxonomyForm(() => undefined);
      fixture.detectChanges();
      expect(component['taxonomyTriggerEl']).toBe(trigger);

      component.cancelTaxonomyForm();
      flushMicrotasks();

      expect(document.activeElement).toBe(trigger);
      expect(component.taxonomyFormOpen).toBeFalse();
      document.body.removeChild(trigger);
    }));

    it('Escape closes the dialog', () => {
      configure(makePacket());
      component.openTaxonomyForm(() => undefined);
      fixture.detectChanges();

      const dialog = fixture.nativeElement.querySelector('.packet-builder__taxonomy-card');
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(component.taxonomyFormOpen).toBeFalse();
    });
  });
});
