import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { PacketListComponent } from './packet-list.component';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Packet } from '../../../game/models/sockbowl/packet-types.generated';

describe('PacketListComponent', () => {
  let fixture: ComponentFixture<PacketListComponent>;
  let component: PacketListComponent;
  let authSpy: jasmine.SpyObj<AuthService>;

  const ownedPacket: Packet = { id: 'p1', name: 'Mine', owner: { id: 'user-1', name: 'Me' } } as Packet;
  const othersPacket: Packet = { id: 'p2', name: 'Theirs', owner: { id: 'user-2', name: 'Them' } } as Packet;
  const ownerlessPacket: Packet = { id: 'p3', name: 'Ownerless', owner: null } as Packet;

  function configure(permissions: string[], currentUserId: string | null): void {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'getCurrentUserId']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.getCurrentUserId.and.returnValue(currentUserId);

    TestBed.configureTestingModule({
      declarations: [PacketListComponent],
      providers: [
        { provide: SockbowlQuestionsService, useValue: {
            getAllPackets: () => of([ownedPacket, othersPacket, ownerlessPacket]),
            searchPacketsByName: () => of([]),
        } },
        { provide: PacketAuthoringService, useValue: {
            getAllDifficulties: () => of([]),
            createPacket: () => of('new-id'),
            deletePacket: () => of(true),
        } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: AuthService, useValue: authSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(PacketListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('hides the New Packet button without packet:create', () => {
    configure([], 'user-1');
    const button = (fixture.nativeElement as HTMLElement).querySelector('.packet-list__new-btn');
    expect(button).toBeNull();
  });

  it('shows the New Packet button with packet:create', () => {
    configure(['packet:create'], 'user-1');
    const button = (fixture.nativeElement as HTMLElement).querySelector('.packet-list__new-btn');
    expect(button).not.toBeNull();
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
});
