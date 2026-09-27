import { NO_ERRORS_SCHEMA } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, ReplaySubject } from 'rxjs';

import { GameConfigComponent } from './game-config.component';
import { GameStateService } from '../../services/game-state.service';
import { GameMessageService } from '../../services/game-message.service';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { PacketPreviewComponent } from '../packet-preview/packet-preview.component';
import { GameSession, Packet } from '../../models/sockbowl/sockbowl-interfaces';

describe('GameConfigComponent proctor preview', () => {
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let questions: jasmine.SpyObj<SockbowlQuestionsService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let component: GameConfigComponent;

  const fullPacket = {
    id: 'packet-1',
    name: 'Packet One',
    tossups: [{ tossup: { question: 'Q1', answer: 'A1' }, order: 1 }],
    bonuses: [],
  } as unknown as Packet;

  function sessionWith(packet: Partial<Packet>): GameSession {
    return {
      gameSettings: {},
      currentMatch: { packet },
      teamList: [],
      playerList: [],
    } as unknown as GameSession;
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>('GameStateService', [
      'isSelfProctor', 'isSinglePlayer', 'isAutoJudgedMultiplayer', 'isCurrentPlayerGameOwner',
      'isProctorless', 'getProctor', 'requestGameSession', 'setMatchPacket', 'updateGameSettings',
    ], { gameSession$: session$.asObservable(), playerSessionId: 'p1' });
    gameStateService.isSelfProctor.and.returnValue(true);
    questions = jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', ['getPacketById']);
    questions.getPacketById.and.returnValue(of(fullPacket));
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [GameConfigComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameMessageService, useValue: { gameEventObservables: { ProcessError: of(null) } } },
        { provide: SockbowlQuestionsService, useValue: questions },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snack },
        { provide: PresentationConnectionService, useValue: { isAvailable$: of(false), connectionState$: of(null) } },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameConfigComponent).componentInstance;
  });

  it('previews the packet from the game session with no questions call', () => {
    session$.next(sessionWith(fullPacket));
    component.ngOnInit();

    component.openPacketPreview();

    expect(dialog.open).toHaveBeenCalledOnceWith(PacketPreviewComponent, jasmine.objectContaining({ data: fullPacket }));
    expect(questions.getPacketById).not.toHaveBeenCalled();
  });

  it('asks the game server for the full session when the packet arrived without questions', () => {
    // A MatchPacketUpdate leaves only an id, a name and a length-only tossup array.
    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One', tossups: new Array(20) } as any));
    component.ngOnInit();
    gameStateService.requestGameSession.calls.reset();

    component.openPacketPreview();

    expect(gameStateService.requestGameSession).toHaveBeenCalledTimes(1);
    expect(dialog.open).not.toHaveBeenCalled();

    session$.next(sessionWith(fullPacket));

    expect(dialog.open).toHaveBeenCalledOnceWith(PacketPreviewComponent, jasmine.objectContaining({ data: fullPacket }));
    expect(questions.getPacketById).not.toHaveBeenCalled();
  });

  it('gives up with a message when the server never sends the questions', fakeAsync(() => {
    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One', tossups: [] } as any));
    component.ngOnInit();

    component.openPacketPreview();
    tick(5000);

    expect(dialog.open).not.toHaveBeenCalled();
    expect(snack.open).toHaveBeenCalled();
    expect(questions.getPacketById).not.toHaveBeenCalled();
  }));

  it('a proctor never loads the packet from questions when it changes', () => {
    component.ngOnInit();

    session$.next(sessionWith({ id: 'packet-2', name: 'Two', tossups: new Array(5) } as any));

    expect(gameStateService.requestGameSession).toHaveBeenCalledTimes(1);
    expect(questions.getPacketById).not.toHaveBeenCalled();
  });

  it('a non-proctor loads only packet metadata from questions', () => {
    gameStateService.isSelfProctor.and.returnValue(false);
    component.ngOnInit();

    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One' } as any));

    expect(questions.getPacketById).toHaveBeenCalledOnceWith('packet-1');
    expect(gameStateService.requestGameSession).not.toHaveBeenCalled();
  });
});
