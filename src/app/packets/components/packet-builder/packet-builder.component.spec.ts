import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { PacketBuilderComponent } from './packet-builder.component';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Packet } from '../../../game/models/sockbowl/packet-types.generated';

describe('PacketBuilderComponent canManagePacket (NG-R2-04)', () => {
  let fixture: ComponentFixture<PacketBuilderComponent>;
  let component: PacketBuilderComponent;
  let authSpy: jasmine.SpyObj<AuthService>;

  function configure(packet: Packet, permissions: string[], currentUserId: string | null): void {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'getCurrentUserId']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.getCurrentUserId.and.returnValue(currentUserId);

    TestBed.configureTestingModule({
      declarations: [PacketBuilderComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => packet.id } } },
        },
        {
          provide: SockbowlQuestionsService,
          useValue: { getPacketById: () => of(packet) },
        },
        {
          provide: PacketAuthoringService,
          useValue: {
            getAllDifficulties: () => of([]),
            getAllCategories: () => of([]),
            getAllSubcategories: () => of([]),
          },
        },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
        { provide: AuthService, useValue: authSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(PacketBuilderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const ownedPacket = { id: 'p1', name: 'Mine', owner: { id: 'user-1', name: 'Me' }, tossups: [], bonuses: [] } as unknown as Packet;
  // A non-owner's read redacts owner.id to null (D2's answer-free
  // projection), rather than nulling out `owner` entirely.
  const redactedPacket = { id: 'p2', name: 'Theirs', owner: { id: null, name: null }, tossups: [], bonuses: [] } as unknown as Packet;

  it('is true for the actual owner', () => {
    configure(ownedPacket, [], 'user-1');
    expect(component.canManagePacket).toBeTrue();
  });

  it('is true for packet:manage-any regardless of ownership', () => {
    configure(redactedPacket, ['packet:manage-any'], 'someone-else');
    expect(component.canManagePacket).toBeTrue();
  });

  it('is false for a redacted owner.id:null packet while the current user id has not resolved yet', () => {
    // Before AuthService's ID-token profile has loaded, getCurrentUserId()
    // can also be null. A naive `owner.id === userId` would wrongly treat
    // that as a match; canManagePacket must require a real, non-null id.
    configure(redactedPacket, [], null);
    expect(component.canManagePacket).toBeFalse();
  });
});
