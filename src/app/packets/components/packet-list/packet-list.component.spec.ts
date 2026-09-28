import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';

import { PacketListComponent } from './packet-list.component';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { PendingPacketService } from '../../../game/services/pending-packet.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { PacketFilter, PacketPage, PacketSummary } from '../../models/packet-authoring.models';

describe('PacketListComponent', () => {
  let fixture: ComponentFixture<PacketListComponent>;
  let component: PacketListComponent;
  let authSpy: jasmine.SpyObj<AuthService>;
  let questionsSpy: jasmine.SpyObj<SockbowlQuestionsService>;
  let authoringSpy: jasmine.SpyObj<PacketAuthoringService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;

  const ownedPacket: PacketSummary = {
    id: 'p1',
    name: 'Mine',
    owner: { id: 'user-1', name: 'Me' },
    visibility: 'DRAFT',
    version: 0,
    tossupCount: 5,
    bonusCount: 2,
    playable: true
  };
  const othersPacket: PacketSummary = {
    id: 'p2',
    name: 'Theirs',
    owner: { id: 'user-2', name: 'Them' },
    visibility: 'PUBLISHED',
    version: 3,
    tossupCount: 10,
    bonusCount: 5,
    playable: true
  };
  const ownerlessPacket: PacketSummary = {
    id: 'p3',
    name: 'Ownerless',
    owner: null,
    visibility: 'PUBLISHED',
    version: 1,
    tossupCount: 1,
    bonusCount: 0,
    playable: false
  };

  function pageOf(items: PacketSummary[]): PacketPage {
    return { items, total: items.length, page: 0, size: 25 };
  }

  function configure(permissions: string[], currentUserId: string | null): void {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'getCurrentUserId']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.getCurrentUserId.and.returnValue(currentUserId);

    questionsSpy = jasmine.createSpyObj('SockbowlQuestionsService', ['listPackets', 'exportPacket']);
    questionsSpy.listPackets.and.returnValue(of(pageOf([ownedPacket, othersPacket, ownerlessPacket])));

    authoringSpy = jasmine.createSpyObj('PacketAuthoringService', [
      'getAllDifficulties',
      'createPacket',
      'deletePacket',
      'clonePacket'
    ]);
    authoringSpy.getAllDifficulties.and.returnValue(of([]));
    authoringSpy.createPacket.and.returnValue(of('new-id'));
    authoringSpy.deletePacket.and.returnValue(of(true));

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    confirmDialogSpy.confirm.and.returnValue(of(true));

    TestBed.configureTestingModule({
      declarations: [PacketListComponent],
      providers: [
        { provide: SockbowlQuestionsService, useValue: questionsSpy },
        { provide: PacketAuthoringService, useValue: authoringSpy },
        { provide: PendingPacketService, useValue: jasmine.createSpyObj('PendingPacketService', ['set', 'get', 'clear']) },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
        { provide: AuthService, useValue: authSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(PacketListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads the first page through listPackets', () => {
    configure(['packet:create'], 'user-1');
    expect(questionsSpy.listPackets).toHaveBeenCalledWith(jasmine.any(Object), 0, 25);
    expect(component.packets.length).toBe(3);
    expect(component.total).toBe(3);
  });

  it('re-paginates through listPackets when the paginator emits a page change', () => {
    configure(['packet:create'], 'user-1');
    questionsSpy.listPackets.calls.reset();
    component.onPageChange({ pageIndex: 2, pageSize: 50, length: 3 });
    expect(questionsSpy.listPackets).toHaveBeenCalledWith(jasmine.any(Object), 2, 50);
  });

  it('sends mine:true when the "my packets only" filter is toggled on', () => {
    configure(['packet:create'], 'user-1');
    questionsSpy.listPackets.calls.reset();
    component.showMineOnly = true;
    component.onMineToggle();
    const filterArg = questionsSpy.listPackets.calls.mostRecent().args[0] as PacketFilter;
    expect(filterArg.mine).toBeTrue();
  });

  it('does not send a mine filter when the toggle is off', () => {
    configure(['packet:create'], 'user-1');
    questionsSpy.listPackets.calls.reset();
    component.showMineOnly = false;
    component.onMineToggle();
    const filterArg = questionsSpy.listPackets.calls.mostRecent().args[0] as PacketFilter;
    expect(filterArg.mine).toBeUndefined();
  });

  it('delete opens the confirm dialog before calling deletePacket', () => {
    configure(['packet:create', 'packet:delete'], 'user-1');
    component.deletePacket(ownedPacket);
    expect(confirmDialogSpy.confirm).toHaveBeenCalled();
    expect(authoringSpy.deletePacket).toHaveBeenCalledWith('p1');
  });

  it('does not delete when the confirm dialog is cancelled', () => {
    configure(['packet:create', 'packet:delete'], 'user-1');
    confirmDialogSpy.confirm.and.returnValue(of(false));
    component.deletePacket(ownedPacket);
    expect(authoringSpy.deletePacket).not.toHaveBeenCalled();
  });

  it('hides New Packet and Import without packet:create', () => {
    configure([], 'user-1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.packet-list__new-btn')).toBeNull();
    expect(el.querySelector('.packet-list__import-btn')).toBeNull();
  });

  it('shows New Packet and Import with packet:create', () => {
    configure(['packet:create'], 'user-1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.packet-list__new-btn')).not.toBeNull();
    expect(el.querySelector('.packet-list__import-btn')).not.toBeNull();
  });

  it('canManage is true for the owner, false for another owned packet', () => {
    configure([], 'user-1');
    expect(component.canManage(ownedPacket)).toBeTrue();
    expect(component.canManage(othersPacket)).toBeFalse();
  });

  it('canManage is false for an ownerless packet without packet:manage-any (no grandfather rule)', () => {
    configure([], 'user-1');
    expect(component.canManage(ownerlessPacket)).toBeFalse();
  });

  it('canManage is true for any packet with packet:manage-any', () => {
    configure(['packet:manage-any'], 'someone-else');
    expect(component.canManage(ownedPacket)).toBeTrue();
    expect(component.canManage(othersPacket)).toBeTrue();
    expect(component.canManage(ownerlessPacket)).toBeTrue();
  });

  it('S4-01: a row the caller can edit (packet:update + canManage) links its name to the builder', () => {
    configure(['packet:create', 'packet:update'], 'user-1');
    const el = fixture.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.packet-list__item');
    const ownedLink = items[0].querySelector('a.packet-list__item-name') as HTMLAnchorElement | null;
    expect(ownedLink?.textContent?.trim()).toBe('Mine');
    // Theirs (p2, no packet:manage-any): not editable, so the name is plain text, not a link.
    expect(items[1].querySelector('a.packet-list__item-name')).toBeNull();
    expect(items[1].querySelector('span.packet-list__item-name')?.textContent?.trim()).toBe('Theirs');
  });

  it('S4-01: without packet:update, no row name is a link even when owned', () => {
    configure([], 'user-1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('a.packet-list__item-name')).toBeNull();
    expect(el.querySelectorAll('span.packet-list__item-name').length).toBe(3);
  });

  // FF1 (finish review, Truth and Copy): "1 bonuses"/"1 tossups" had no
  // singular form.
  it('pluralizes the tossup/bonus counts', () => {
    configure([], 'user-1');
    const el = fixture.nativeElement as HTMLElement;
    const counts = Array.from(el.querySelectorAll('.packet-list__item-counts')).map(n => n.textContent?.trim());
    expect(counts).toContain('5 tossups · 2 bonuses'); // ownedPacket
    expect(counts).toContain('10 tossups · 5 bonuses'); // othersPacket
    expect(counts).toContain('1 tossup · 0 bonuses'); // ownerlessPacket: singular tossup, plural (zero) bonuses
  });

  it('play test navigates to the game lobby with the mode/packetId query params', () => {
    configure(['packet:create'], 'user-1');
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    component.playTest(othersPacket);
    expect(router.navigate).toHaveBeenCalledWith(['/game-session'], {
      queryParams: { mode: 'single', packetId: 'p2' }
    });
  });

  it(
    'play test does NOT pre-set the pending packet in sessionStorage (NG-V1-05): ' +
      'GameSessionComponent sets it from the query param it just navigated with',
    () => {
      configure(['packet:create'], 'user-1');
      const pending = TestBed.inject(PendingPacketService) as jasmine.SpyObj<PendingPacketService>;
      component.playTest(othersPacket);
      expect(pending.set).not.toHaveBeenCalled();
    },
  );

  it('duplicate calls clonePacket and navigates to the new packet\'s builder', () => {
    configure(['packet:create'], 'user-1');
    authoringSpy.clonePacket.and.returnValue(of('clone-id'));
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    component.duplicatePacket(ownedPacket);
    expect(authoringSpy.clonePacket).toHaveBeenCalledWith('p1');
    expect(router.navigate).toHaveBeenCalledWith(['/packets', 'clone-id', 'edit']);
  });

  it('canManage is false for a redacted owner.id:null packet while the current user id has not resolved yet (NG-R2-04)', () => {
    // A non-owner's read redacts owner.id to null (D2). Before
    // updateUserProfile resolves, getCurrentUserId() can also be null — a
    // naive `packet.owner.id === userId` would wrongly match null === null.
    configure([], null);
    const redactedPacket = { id: 'p4', name: 'Someone else’s', owner: { id: null, name: null } } as unknown as PacketSummary;
    expect(component.canManage(redactedPacket)).toBeFalse();
  });

  it('"My packets" is decided by the server\'s mine filter, never by matching redacted owners, while the current user id has not resolved yet (NG-R2-04)', () => {
    // M3 (PB-14) replaced the client-side owner.id comparison with the
    // server's `mine: true` filter, so a null current-user id cannot match a
    // redacted owner.id:null packet: the page shown is exactly what the
    // server returned for `mine`.
    configure([], null);
    questionsSpy.listPackets.calls.reset();
    questionsSpy.listPackets.and.returnValue(of(pageOf([])));
    component.showMineOnly = true;
    component.onMineToggle();
    const filterArg = questionsSpy.listPackets.calls.mostRecent().args[0] as PacketFilter;
    expect(filterArg.mine).toBeTrue();
    expect(component.packets).toEqual([]);
  });

  describe('S4-13: load error and per-class empty states', () => {
    it('a load failure sets loadError and renders a Retry state with no snackbar', () => {
      configure(['packet:create'], 'user-1');
      const snackBar = TestBed.inject(MatSnackBar) as jasmine.SpyObj<MatSnackBar>;
      snackBar.open.calls.reset();
      questionsSpy.listPackets.and.returnValue(throwError(() => new Error('network down')));

      component.load();
      fixture.detectChanges();

      expect(component.loadError).not.toBeNull();
      expect(component.loading).toBeFalse();
      expect(snackBar.open).not.toHaveBeenCalled();
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain("Couldn't load packets");
      expect(fixture.nativeElement.querySelector('.packet-list__state--error button')).not.toBeNull();
    });

    it('Retry (re-calling load) clears loadError on success', () => {
      configure(['packet:create'], 'user-1');
      questionsSpy.listPackets.and.returnValue(throwError(() => new Error('boom')));
      component.load();
      expect(component.loadError).not.toBeNull();

      questionsSpy.listPackets.and.returnValue(of(pageOf([ownedPacket])));
      component.load();

      expect(component.loadError).toBeNull();
      expect(component.packets.length).toBe(1);
    });

    it('shows "No packets yet" with New Packet/Import when there are no filters and no packets', () => {
      configure(['packet:create'], 'user-1');
      questionsSpy.listPackets.and.returnValue(of(pageOf([])));
      component.load();
      fixture.detectChanges();

      expect(component.hasActiveFilters).toBeFalse();
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('No packets yet');
    });

    it('shows "No packets match these filters" with Clear filters when a filter narrowed the result to nothing', () => {
      configure(['packet:create'], 'user-1');
      questionsSpy.listPackets.and.returnValue(of(pageOf([])));
      component.showMineOnly = true;
      component.load();
      fixture.detectChanges();

      expect(component.hasActiveFilters).toBeTrue();
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('No packets match these filters');

      questionsSpy.listPackets.calls.reset();
      questionsSpy.listPackets.and.returnValue(of(pageOf([ownedPacket])));
      component.clearFilters();

      expect(component.showMineOnly).toBeFalse();
      expect(questionsSpy.listPackets).toHaveBeenCalled();
    });
  });
});
