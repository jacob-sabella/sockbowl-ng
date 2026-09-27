import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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

  it('play test stashes the pending packet id and navigates to the game lobby', () => {
    configure(['packet:create'], 'user-1');
    const pending = TestBed.inject(PendingPacketService) as jasmine.SpyObj<PendingPacketService>;
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    component.playTest(othersPacket);
    expect(pending.set).toHaveBeenCalledWith('p2');
    expect(router.navigate).toHaveBeenCalledWith(['/game-session'], {
      queryParams: { mode: 'single', packetId: 'p2' }
    });
  });

  it('duplicate calls clonePacket and navigates to the new packet\'s builder', () => {
    configure(['packet:create'], 'user-1');
    authoringSpy.clonePacket.and.returnValue(of('clone-id'));
    const router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    component.duplicatePacket(ownedPacket);
    expect(authoringSpy.clonePacket).toHaveBeenCalledWith('p1');
    expect(router.navigate).toHaveBeenCalledWith(['/packets', 'clone-id', 'edit']);
  });
});
