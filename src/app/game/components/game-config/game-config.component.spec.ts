import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, ReplaySubject, Subject } from 'rxjs';

import { GameConfigComponent } from './game-config.component';
import { GameStateService } from '../../services/game-state.service';
import { GameMessageService } from '../../services/game-message.service';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { PendingPacketService } from '../../services/pending-packet.service';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { PacketPreviewComponent } from '../packet-preview/packet-preview.component';
import { PacketSearchComponent } from '../packet-search/packet-search.component';
import { GameSession, MatchState, Packet, PlayerMode } from '../../models/sockbowl/sockbowl-interfaces';
import { PresentationConnectionState } from '../../models/cast-interfaces';

describe('GameConfigComponent proctor preview', () => {
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let questions: jasmine.SpyObj<SockbowlQuestionsService>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let component: GameConfigComponent;
  let processErrors$: Subject<any>;

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
    processErrors$ = new Subject<any>();
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
        { provide: GameMessageService, useValue: { gameEventObservables: { ProcessError: processErrors$ } } },
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

  it('a non-proctor with a packet id takes the metadata from the session, not from questions', () => {
    // The owner in a proctorless mode is sent the id but still no questions.
    gameStateService.isSelfProctor.and.returnValue(false);
    component.ngOnInit();

    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One', tossups: new Array(20), bonuses: new Array(4) } as any));

    expect(questions.getPacketById).not.toHaveBeenCalled();
    expect(gameStateService.requestGameSession).not.toHaveBeenCalled();
    expect(component.selectedPacket?.name).toBe('Packet One');
    expect(component.getBonusCount()).toBe(4);
  });

  // WP-FIXG5 sends non-proctors MatchPacketUpdate{packetId:null, packetName,
  // tossupCount, bonusCount}, and GameStateService turns it into a session
  // packet with no id and length-only arrays (NG-R3-01, second effect).
  it('a non-proctor shows the packet name and bonus count with no packet id and no questions call', () => {
    gameStateService.isSelfProctor.and.returnValue(false);
    component.ngOnInit();

    session$.next(sessionWith({ id: null, name: 'Generated Packet', tossups: new Array(10), bonuses: new Array(3) } as any));

    expect(questions.getPacketById).not.toHaveBeenCalled();
    expect(gameStateService.requestGameSession).not.toHaveBeenCalled();
    expect(component.isPacketSet()).toBeTrue();
    expect(component.selectedPacketId).toBe('');
    expect(component.selectedPacket?.name).toBe('Generated Packet');
    expect(component.hasPacketBonuses()).toBeTrue();
    expect(component.getBonusCount()).toBe(3);
  });

  it('a non-proctor drops the id-less packet when it is cleared', () => {
    gameStateService.isSelfProctor.and.returnValue(false);
    component.ngOnInit();
    session$.next(sessionWith({ id: null, name: 'Generated Packet', tossups: new Array(10), bonuses: new Array(3) } as any));

    session$.next(sessionWith({ id: null, name: null, tossups: [], bonuses: [] } as any));

    expect(component.isPacketSet()).toBeFalse();
    expect(component.selectedPacket).toBeNull();
  });

  it('the proctor adopts the server counts over the counts the packet dialog guessed', () => {
    component.ngOnInit();
    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One', tossups: new Array(5) } as any));
    // The dialog handed back a packet with no bonus count (an older questions
    // service that doesn't return counts from import-random).
    component.selectedPacket = { id: 'packet-1', name: 'Packet One', tossups: new Array(5), bonuses: [] } as any;

    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One', tossups: new Array(5), bonuses: new Array(2) } as any));

    expect(component.getBonusCount()).toBe(2);
  });

  it('resets the selected packet display when a MatchPacketUpdate clears the packet', () => {
    component.ngOnInit();

    session$.next(sessionWith({ id: 'packet-1', name: 'Packet One' } as any));
    expect(component.selectedPacketId).toBe('packet-1');

    // A proctor seat change or mode change clears the packet: the server
    // sends MatchPacketUpdate{packetId:null, tossupCount:0}, which
    // GameStateService turns into a packet with a null id and no tossups.
    session$.next(sessionWith({ id: null, name: null, tossups: [] } as any));

    expect(component.selectedPacketId).toBe('');
    expect(component.selectedPacket).toBeNull();
  });
  it('explains a PACKET_NOT_AVAILABLE refusal and drops the optimistic pick', () => {
    component.ngOnInit();
    session$.next(sessionWith({ id: null, name: null, tossups: [] } as any));
    // The packet dialog set this optimistically before the server answered.
    component.packetId = 'other-game-packet';
    component.selectedPacketId = 'other-game-packet';
    component.selectedPacket = { id: 'other-game-packet', name: 'Theirs', tossups: new Array(5), bonuses: new Array(5) } as any;

    processErrors$.next({
      code: 'PACKET_NOT_AVAILABLE',
      error: 'Packet id other-game-packet is not available for play',
    });

    expect(snack.open).toHaveBeenCalledWith(
      jasmine.stringMatching(/can't be used in this game/), 'Dismiss', jasmine.anything());
    expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/other-game-packet/), jasmine.anything(), jasmine.anything());
    expect(component.selectedPacket).toBeNull();
    expect(component.selectedPacketId).toBe('');
    expect(component.packetId).toBe('');
  });

  it('keeps the current packet when a refused pick is reverted', () => {
    component.ngOnInit();
    session$.next(sessionWith(fullPacket));
    component.selectedPacketId = 'other-game-packet';
    component.selectedPacket = { id: 'other-game-packet', name: 'Theirs' } as any;

    processErrors$.next({ code: 'PACKET_NOT_AVAILABLE', error: 'not available' });

    expect(component.selectedPacketId).toBe('packet-1');
    expect(component.selectedPacket).toBe(fullPacket);
  });

  it('shows a generic ProcessError as the server sent it', () => {
    component.ngOnInit();
    processErrors$.next({ error: 'StartMatch: Permission Denied' });
    expect(snack.open).toHaveBeenCalledWith('StartMatch: Permission Denied', 'Dismiss', jasmine.anything());
  });

  describe('packet dialog confirmation follows the server echo (S3-19)', () => {
    function openDialogWith(result: Packet | undefined): void {
      dialog.open.and.returnValue({ afterClosed: () => of(result) } as any);
      component.openPacketSearch();
    }

    it('does not confirm merely because the dialog closed with a pick', () => {
      component.ngOnInit();
      session$.next(sessionWith({ id: null, name: null, tossups: [] } as any));
      snack.open.calls.reset();

      openDialogWith({ id: 'packet-7', name: 'Regionals', tossups: [], bonuses: [] } as any);

      expect(gameStateService.setMatchPacket).toHaveBeenCalledWith('packet-7');
      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());
    });

    it('shows "Packet \'<name>\' selected." once the session echoes the same id back', () => {
      component.ngOnInit();
      session$.next(sessionWith({ id: null, name: null, tossups: [] } as any));
      snack.open.calls.reset();

      openDialogWith({ id: 'packet-7', name: 'Regionals', tossups: [], bonuses: [] } as any);
      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());

      session$.next(sessionWith({ id: 'packet-7', name: 'Regionals' } as any));

      expect(snack.open).toHaveBeenCalledWith("Packet 'Regionals' selected.", 'OK', jasmine.anything());
    });

    it('never confirms if a different packet lands on the session first', () => {
      component.ngOnInit();
      session$.next(sessionWith({ id: null, name: null, tossups: [] } as any));

      openDialogWith({ id: 'packet-7', name: 'Regionals', tossups: [], bonuses: [] } as any);
      session$.next(sessionWith({ id: 'packet-other', name: "Someone else's" } as any));

      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());
    });
  });

  describe('picker opens full-screen below 600px (S3-10)', () => {
    let matchMediaSpy: jasmine.Spy;

    beforeEach(() => {
      component.ngOnInit();
      session$.next(sessionWith(fullPacket));
      dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as any);
    });

    afterEach(() => {
      matchMediaSpy?.and.stub();
    });

    function stubMatchMedia(matches: boolean): void {
      matchMediaSpy = spyOn(window, 'matchMedia').and.returnValue({ matches } as MediaQueryList);
    }

    it('opens a compact, edge-to-edge dialog at <=600px', () => {
      stubMatchMedia(true);

      component.openPacketSearch();

      expect(matchMediaSpy).toHaveBeenCalledWith('(max-width: 600px)');
      expect(dialog.open).toHaveBeenCalledOnceWith(PacketSearchComponent, jasmine.objectContaining({
        width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh',
        panelClass: 'packet-search-dialog--fullscreen',
      }));
    });

    it('opens the centered dialog above 600px', () => {
      stubMatchMedia(false);

      component.openPacketSearch();

      expect(dialog.open).toHaveBeenCalledOnceWith(PacketSearchComponent, jasmine.objectContaining({
        width: '680px', maxWidth: '96vw',
      }));
      expect(dialog.open.calls.mostRecent().args[1]).not.toEqual(jasmine.objectContaining({ panelClass: jasmine.anything() }));
    });
  });
});

describe('GameConfigComponent impeccable polish (S3)', () => {
  let session$: ReplaySubject<GameSession>;
  let processErrorsS3$: Subject<any>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let component: GameConfigComponent;

  function sessionWith(overrides: Partial<GameSession>): GameSession {
    return {
      gameSettings: {},
      currentMatch: { packet: null },
      teamList: [],
      playerList: [],
      ...overrides,
    } as unknown as GameSession;
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    processErrorsS3$ = new Subject<any>();
    gameStateService = jasmine.createSpyObj<GameStateService>('GameStateService', [
      'isSelfProctor', 'isSinglePlayer', 'isAutoJudgedMultiplayer', 'isCurrentPlayerGameOwner',
      'isProctorless', 'getProctor', 'requestGameSession', 'setMatchPacket', 'updateGameSettings',
      'getCurrentPlayer', 'startMatch', 'isSelfSpectator', 'getCurrentPlayerTeam', 'isFreeForAll',
    ], { gameSession$: session$.asObservable(), playerSessionId: 'p1' });
    gameStateService.isSelfProctor.and.returnValue(true);

    TestBed.configureTestingModule({
      declarations: [GameConfigComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameMessageService, useValue: { gameEventObservables: { ProcessError: processErrorsS3$ } } },
        { provide: SockbowlQuestionsService, useValue: jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', ['getPacketById']) },
        { provide: MatDialog, useValue: jasmine.createSpyObj<MatDialog>('MatDialog', ['open']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']) },
        {
          provide: PresentationConnectionService,
          useValue: {
            isAvailable$: of(false),
            connectionState$: of(null),
            startPresentation: jasmine.createSpy('startPresentation'),
            stopPresentation: jasmine.createSpy('stopPresentation'),
          },
        },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameConfigComponent).componentInstance;
  });

  it('loads bonusesEnabled from the session on init, instead of always starting unchecked (S3-03)', () => {
    session$.next(sessionWith({ gameSettings: { bonusesEnabled: true } as any }));
    component.ngOnInit();

    expect(component.bonusesEnabled).toBeTrue();
  });

  it('keeps bonusesEnabled in step with later session updates (S3-03)', () => {
    component.ngOnInit();
    session$.next(sessionWith({ gameSettings: { bonusesEnabled: true } as any }));
    expect(component.bonusesEnabled).toBeTrue();

    session$.next(sessionWith({ gameSettings: { bonusesEnabled: false } as any }));
    expect(component.bonusesEnabled).toBeFalse();
  });

  it('reports the tossup count alongside the bonus count (S3-08)', () => {
    component.selectedPacket = { tossups: new Array(20), bonuses: new Array(4) } as any;
    expect(component.getTossupCount()).toBe(20);
  });

  it('reports zero tossups when no packet is selected (S3-08)', () => {
    component.selectedPacket = null;
    expect(component.getTossupCount()).toBe(0);
  });

  it('labels each packet visibility in words, never the raw enum (S3-08)', () => {
    component.selectedPacket = { visibility: 'EPHEMERAL' } as any;
    expect(component.packetVisibilityLabel()).toBe('Game-only, 24h');

    component.selectedPacket = { visibility: 'DRAFT' } as any;
    expect(component.packetVisibilityLabel()).toBe('Draft');

    component.selectedPacket = { visibility: 'PUBLISHED' } as any;
    expect(component.packetVisibilityLabel()).toBe('Published');
  });

  it('shows no visibility label when the view carries none (H-03, S3-08)', () => {
    component.selectedPacket = {} as any;
    expect(component.packetVisibilityLabel()).toBeNull();
  });

  it('states in words why Start is disabled with no packet chosen (S3-17)', () => {
    session$.next(sessionWith({ currentMatch: { packet: null } as any }));
    component.ngOnInit();

    expect(component.startDisabledReason()).toBe('Choose a packet to start');
  });

  it('has no disabled reason once a packet is set (S3-17)', () => {
    session$.next(sessionWith({ currentMatch: { packet: { id: 'packet-1', name: 'Packet One' } } as any }));
    component.ngOnInit();

    expect(component.startDisabledReason()).toBe('');
  });

  it('identifies the signed-in viewer for the "You" marker (S3-11)', () => {
    gameStateService.getCurrentPlayer.and.returnValue({ playerId: 'p1' } as any);

    expect(component.isSelfPlayer('p1')).toBeTrue();
    expect(component.isSelfPlayer('p2')).toBeFalse();
    expect(component.isSelfPlayer(undefined)).toBeFalse();
  });

  describe('non-manager launch-bar status line (S3-20)', () => {
    it('tells a spectator they are watching', () => {
      gameStateService.isSelfSpectator.and.returnValue(true);

      expect(component.nonManagerStatusLine()).toBe('Watching as a spectator');
    });

    it('tells a seated player their team and who they are waiting for', () => {
      gameStateService.isSelfSpectator.and.returnValue(false);
      gameStateService.getCurrentPlayerTeam.and.returnValue({ teamName: 'Team A' } as any);
      gameStateService.getProctor.and.returnValue({ name: 'Grace' } as any);

      expect(component.nonManagerStatusLine()).toBe("You're on Team A · Waiting for Grace to start");
    });

    it('falls back to the game owner\'s name when no proctor has claimed the seat yet', () => {
      session$.next(sessionWith({
        playerList: [{ playerId: 'p9', name: 'Owen', gameOwner: true } as any],
      }));
      component.ngOnInit();
      gameStateService.isSelfSpectator.and.returnValue(false);
      gameStateService.getCurrentPlayerTeam.and.returnValue({ teamName: 'Team A' } as any);
      gameStateService.getProctor.and.returnValue(undefined);

      expect(component.nonManagerStatusLine()).toBe("You're on Team A · Waiting for Owen to start");
    });

    it('falls back to "the host" when neither a proctor nor a game owner is known', () => {
      gameStateService.isSelfSpectator.and.returnValue(false);
      gameStateService.getCurrentPlayerTeam.and.returnValue({ teamName: 'Team A' } as any);
      gameStateService.getProctor.and.returnValue(undefined);

      expect(component.nonManagerStatusLine()).toBe("You're on Team A · Waiting for the host to start");
    });

    it('tells an unseated player to pick a team', () => {
      gameStateService.isSelfSpectator.and.returnValue(false);
      gameStateService.getCurrentPlayerTeam.and.returnValue(undefined);

      expect(component.nonManagerStatusLine()).toBe('Pick a team to play');
    });
  });

  describe('role-aware "no packet" copy (S3-20)', () => {
    it('gives the manager an actionable instruction', () => {
      gameStateService.isSelfProctor.and.returnValue(true);

      expect(component.packetEmptyMessage()).toBe(
        'No packet yet. Generate one from the question bank or search the library to set the questions for this match.');
    });

    it('tells a non-manager the proctor has not chosen one yet', () => {
      gameStateService.isSelfProctor.and.returnValue(false);
      gameStateService.isSinglePlayer.and.returnValue(false);
      gameStateService.isAutoJudgedMultiplayer.and.returnValue(false);
      gameStateService.getProctor.and.returnValue({ name: 'Grace' } as any);

      expect(component.packetEmptyMessage()).toBe("The proctor hasn't chosen a packet yet.");
    });

    it('says "the host" instead when there is no proctor role in this mode', () => {
      gameStateService.isSelfProctor.and.returnValue(false);
      gameStateService.isSinglePlayer.and.returnValue(false);
      gameStateService.isAutoJudgedMultiplayer.and.returnValue(false);
      gameStateService.getProctor.and.returnValue(undefined);

      expect(component.packetEmptyMessage()).toBe("The host hasn't chosen a packet yet.");
    });
  });

  describe('timer field commit/clamp/revert (S3-09)', () => {
    beforeEach(() => {
      // canEditTimerSettings() needs a session with settings to build the
      // updated GameSettings from; isSelfProctor() already defaults true.
      session$.next(sessionWith({
        gameSettings: {
          proctorType: 'CLASSIC', gameMode: 'STANDARD', bonusesEnabled: false,
          timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
        } as any,
      }));
      component.ngOnInit();
    });

    it('clamps a tossup timer value above the max down to 60', () => {
      component.tossupTimerSeconds = 999;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(60);
      expect(gameStateService.updateGameSettings).toHaveBeenCalled();
    });

    it('clamps a tossup timer value below the min up to 1', () => {
      component.tossupTimerSeconds = -3;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(1);
    });

    it('reverts an emptied tossup timer field to the last committed value instead of sending null', () => {
      component.tossupTimerSeconds = null as unknown as number;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(5);
    });

    it('reverts a NaN tossup timer field (a stray non-numeric keystroke) to the committed value', () => {
      component.tossupTimerSeconds = NaN;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(5);
    });

    it('remembers a clamped commit as the new revert target', () => {
      component.tossupTimerSeconds = 40;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(40);

      component.tossupTimerSeconds = null as unknown as number;
      component.commitTossupTimer();
      expect(component.tossupTimerSeconds).toBe(40);
    });

    it('clamps the bonus timer to [1,60] independently of the tossup timer', () => {
      component.bonusTimerSeconds = 0;
      component.commitBonusTimer();
      expect(component.bonusTimerSeconds).toBe(1);
    });

    it('clamps the reading speed to [1,10]', () => {
      component.readingWordsPerSecond = 25;
      component.commitReadingSpeed();
      expect(component.readingWordsPerSecond).toBe(10);

      component.readingWordsPerSecond = undefined as unknown as number;
      component.commitReadingSpeed();
      expect(component.readingWordsPerSecond).toBe(10);
    });

    it('does not push a timer commit when the viewer may not edit timer settings', () => {
      gameStateService.isSelfProctor.and.returnValue(false);
      gameStateService.isAutoJudgedMultiplayer.and.returnValue(false);
      gameStateService.updateGameSettings.calls.reset();

      component.tossupTimerSeconds = 999;
      component.commitTossupTimer();

      // Still clamps the field locally...
      expect(component.tossupTimerSeconds).toBe(60);
      // ...but never sends an update the backend would reject anyway.
      expect(gameStateService.updateGameSettings).not.toHaveBeenCalled();
    });
  });

  describe('Start guards against a double click (S3-09)', () => {
    it('sends StartMatch only once for two rapid clicks', () => {
      component.startMatch();
      component.startMatch();

      expect(gameStateService.startMatch).toHaveBeenCalledTimes(1);
      expect(component.startPending).toBeTrue();
    });

    it('frees Start back up once a ProcessError arrives', () => {
      component.ngOnInit();
      component.startMatch();
      expect(component.startPending).toBeTrue();

      processErrorsS3$.next({ code: 'START_FAILED', error: 'could not start' });

      expect(component.startPending).toBeFalse();
      component.startMatch();
      expect(gameStateService.startMatch).toHaveBeenCalledTimes(2);
    });

    it('frees Start back up on its own after the timeout even with no ProcessError', fakeAsync(() => {
      component.startMatch();
      expect(component.startPending).toBeTrue();

      tick(6000);

      expect(component.startPending).toBeFalse();
    }));
  });

  describe('spectators() filtering and the empty spectators state (S3-12)', () => {
    it('returns only players in SPECTATOR mode', () => {
      const session = sessionWith({
        playerList: [
          { playerId: 'p1', name: 'Alice', playerMode: PlayerMode.BUZZER } as any,
          { playerId: 'p2', name: 'Bob', playerMode: PlayerMode.SPECTATOR } as any,
          { playerId: 'p3', name: 'Cara', playerMode: PlayerMode.SPECTATOR } as any,
        ],
      });

      const result = component.spectators(session);

      expect(result.map(p => p.playerId)).toEqual(['p2', 'p3']);
    });

    it('returns an empty array (not a blank-but-populated list) when no one is spectating', () => {
      const session = sessionWith({
        playerList: [{ playerId: 'p1', name: 'Alice', playerMode: PlayerMode.BUZZER } as any],
      });

      expect(component.spectators(session)).toEqual([]);
    });

    it('handles a missing playerList without throwing', () => {
      const session = sessionWith({ playerList: undefined as any });

      expect(component.spectators(session)).toEqual([]);
    });

    it('does not choke on an extreme, emoji or RTL player name (structural only)', () => {
      const longName = 'A'.repeat(200);
      const session = sessionWith({
        playerList: [
          { playerId: 'p1', name: longName, playerMode: PlayerMode.SPECTATOR } as any,
          { playerId: 'p2', name: '🎉🎉🎉', playerMode: PlayerMode.SPECTATOR } as any,
          { playerId: 'p3', name: 'مرحبا', playerMode: PlayerMode.SPECTATOR } as any,
        ],
      });

      const result = component.spectators(session);

      expect(result.length).toBe(3);
      expect(result[0].name).toBe(longName);
    });
  });

  describe('readiness strip: Players is a count, not a checklist step (S3-21)', () => {
    it('reads "0 players yet" with no one seated', () => {
      const session = sessionWith({ teamList: [{ teamId: 't1', teamPlayers: [] } as any] });
      gameStateService.isFreeForAll.and.returnValue(false);
      session$.next(session);
      component.ngOnInit();

      expect(component.playerCountLabel()).toBe('0 players yet');
    });

    it('pluralises the count across every team', () => {
      gameStateService.isFreeForAll.and.returnValue(false);
      session$.next(sessionWith({
        teamList: [
          { teamId: 't1', teamPlayers: [{ playerId: 'p1' }] } as any,
          { teamId: 't2', teamPlayers: [{ playerId: 'p2' }, { playerId: 'p3' }] } as any,
        ],
      }));
      component.ngOnInit();

      expect(component.playerCountLabel()).toBe('3 players');
    });

    it('uses the singular for exactly one player', () => {
      gameStateService.isFreeForAll.and.returnValue(false);
      session$.next(sessionWith({ teamList: [{ teamId: 't1', teamPlayers: [{ playerId: 'p1' }] } as any] }));
      component.ngOnInit();

      expect(component.playerCountLabel()).toBe('1 player');
    });

    it('counts from playerList in free-for-all, where teamList is not the source of truth', () => {
      gameStateService.isFreeForAll.and.returnValue(true);
      session$.next(sessionWith({
        teamList: [],
        playerList: [
          { playerId: 'p1', playerMode: PlayerMode.BUZZER } as any,
          { playerId: 'p2', playerMode: PlayerMode.BUZZER } as any,
          { playerId: 'p3', playerMode: PlayerMode.SPECTATOR } as any,
        ],
      }));
      component.ngOnInit();

      expect(component.playerCountLabel()).toBe('2 players');
    });
  });

  describe('Start button reads "Starting…" while pending (S3-21, alongside S3-09)', () => {
    it('reports "Start Match" normally and "Starting…" once a click is in flight', () => {
      expect(component.startButtonLabel()).toBe('Start Match');

      component.startMatch();

      expect(component.startButtonLabel()).toBe('Starting…');
    });
  });

  describe('solo owner may edit their own timer settings (S3-25)', () => {
    beforeEach(() => {
      session$.next(sessionWith({
        gameSettings: {
          proctorType: 'NONE', gameMode: 'SINGLE_PLAYER', bonusesEnabled: false,
          timerSettings: { tossupTimerSeconds: 5, bonusTimerSeconds: 5, autoTimerEnabled: true, readingWordsPerSecond: 4 },
        } as any,
      }));
      component.ngOnInit();
      gameStateService.isSelfProctor.and.returnValue(false);
      gameStateService.isAutoJudgedMultiplayer.and.returnValue(false);
    });

    it('may edit timer settings as the single-player owner (matches the backend\'s isProctorless gate)', () => {
      gameStateService.isProctorless.and.returnValue(true);
      gameStateService.isCurrentPlayerGameOwner.and.returnValue(true);

      expect(component.canEditTimerSettings()).toBeTrue();
    });

    it('still cannot edit timer settings if somehow not the session owner in a proctorless game', () => {
      gameStateService.isProctorless.and.returnValue(true);
      gameStateService.isCurrentPlayerGameOwner.and.returnValue(false);

      expect(component.canEditTimerSettings()).toBeFalse();
    });
  });

  describe('cast control: three states, never vanishing (S3-26)', () => {
    it('offers to start casting when disconnected (and equally for a terminated connection)', () => {
      expect(component.castButtonLabel(PresentationConnectionState.DISCONNECTED)).toBe('Cast to TV');
      expect(component.castButtonLabel(PresentationConnectionState.TERMINATED)).toBe('Cast to TV');
      expect(component.castButtonLabel(null)).toBe('Cast to TV');
    });

    it('reads "Connecting…" while the handshake is in progress', () => {
      expect(component.castButtonLabel(PresentationConnectionState.CONNECTING)).toBe('Connecting…');
    });

    it('reads "Casting · Stop" once connected', () => {
      expect(component.castButtonLabel(PresentationConnectionState.CONNECTED)).toBe('Casting · Stop');
    });

    it('starts casting from disconnected, and does nothing while connecting', () => {
      const presentationConnectionService = TestBed.inject(PresentationConnectionService) as unknown as
        { startPresentation: jasmine.Spy; stopPresentation: jasmine.Spy };

      component.onCastButtonClick(PresentationConnectionState.DISCONNECTED);
      expect(presentationConnectionService.startPresentation).toHaveBeenCalledTimes(1);

      component.onCastButtonClick(PresentationConnectionState.CONNECTING);
      expect(presentationConnectionService.startPresentation).toHaveBeenCalledTimes(1);
      expect(presentationConnectionService.stopPresentation).not.toHaveBeenCalled();
    });

    it('stops casting when connected', () => {
      const presentationConnectionService = TestBed.inject(PresentationConnectionService) as unknown as
        { stopPresentation: jasmine.Spy };

      component.onCastButtonClick(PresentationConnectionState.CONNECTED);

      expect(presentationConnectionService.stopPresentation).toHaveBeenCalledTimes(1);
    });
  });
});

describe('GameConfigComponent rendered lobby (S3-28)', () => {
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let fixture: ReturnType<typeof TestBed.createComponent<GameConfigComponent>>;

  function sessionWith(overrides: Partial<GameSession>): GameSession {
    return {
      gameSettings: {},
      currentMatch: { packet: null },
      teamList: [],
      playerList: [],
      ...overrides,
    } as unknown as GameSession;
  }

  beforeEach(() => {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>('GameStateService', [
      'isSelfProctor', 'isSinglePlayer', 'isAutoJudgedMultiplayer', 'isCurrentPlayerGameOwner',
      'isProctorless', 'isAutoProctor', 'isFreeForAll', 'getProctor', 'requestGameSession',
      'setMatchPacket', 'updateGameSettings', 'getCurrentPlayer', 'startMatch', 'isSelfSpectator',
      'getCurrentPlayerTeam', 'isSelfOnTeam', 'isSelfOnAnyTeam',
    ], { gameSession$: session$.asObservable(), playerSessionId: 'p1' });
    gameStateService.isSelfProctor.and.returnValue(true);
    gameStateService.isProctorless.and.returnValue(false);
    gameStateService.isFreeForAll.and.returnValue(false);
    gameStateService.isSelfOnTeam.and.returnValue(false);
    gameStateService.isSelfOnAnyTeam.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [GameConfigComponent],
      imports: [CommonModule],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameMessageService, useValue: { gameEventObservables: { ProcessError: of(null) } } },
        { provide: SockbowlQuestionsService, useValue: jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', ['getPacketById']) },
        { provide: MatDialog, useValue: jasmine.createSpyObj<MatDialog>('MatDialog', ['open']) },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']) },
        { provide: PresentationConnectionService, useValue: { isAvailable$: of(false), connectionState$: of(null) } },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(GameConfigComponent);
    fixture.componentInstance.ngOnInit();
    session$.next(sessionWith({ teamList: [{ teamId: 't1', teamName: 'Team A', teamPlayers: [] } as any] }));
    fixture.detectChanges();
  });

  it('renders Spectate as a stroked button, never a raised primary one (S3-28)', () => {
    const el: HTMLElement = fixture.nativeElement;
    const spectateBtn = Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent?.includes('Spectate')) as HTMLButtonElement | undefined;

    expect(spectateBtn).withContext('Spectate button should render for the proctor seat').toBeTruthy();
    expect(spectateBtn?.hasAttribute('mat-stroked-button')).toBeTrue();
    expect(spectateBtn?.hasAttribute('mat-raised-button')).toBeFalse();
  });

  it('puts each team\'s Join button in its header, beside the count (S3-27)', () => {
    gameStateService.isSelfProctor.and.returnValue(false);
    session$.next(sessionWith({ teamList: [{ teamId: 't1', teamName: 'Team A', teamPlayers: [] } as any] }));
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const header = el.querySelector('.team__header');
    const joinBtn = header?.querySelector('.team__join') as HTMLButtonElement | null;

    expect(header?.querySelector('.team__count')).withContext('the count stays in the header').toBeTruthy();
    expect(joinBtn).withContext('Join should render inside the team header').toBeTruthy();
    expect(joinBtn?.hasAttribute('mat-stroked-button')).toBeTrue();
    expect(joinBtn?.getAttribute('aria-label')).toBe('Join Team A');
    expect(el.querySelector('.team__actions')).withContext('the old actions row is gone').toBeNull();
  });
});

describe('GameConfigComponent pending packet (PB-15)', () => {
  let session$: ReplaySubject<GameSession>;
  let gameStateService: jasmine.SpyObj<GameStateService>;
  let questions: jasmine.SpyObj<SockbowlQuestionsService>;
  let pendingPacketService: PendingPacketService;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let component: GameConfigComponent;

  function configSession(): GameSession {
    return {
      gameSettings: {},
      currentMatch: { matchState: MatchState.CONFIG, packet: null },
      teamList: [],
      playerList: [],
    } as unknown as GameSession;
  }

  function configure(): void {
    session$ = new ReplaySubject<GameSession>(1);
    gameStateService = jasmine.createSpyObj<GameStateService>('GameStateService', [
      'isSelfProctor', 'isSinglePlayer', 'isAutoJudgedMultiplayer', 'isCurrentPlayerGameOwner',
      'isProctorless', 'getProctor', 'requestGameSession', 'setMatchPacket', 'updateGameSettings',
    ], { gameSession$: session$.asObservable(), playerSessionId: 'p1' });
    questions = jasmine.createSpyObj<SockbowlQuestionsService>('SockbowlQuestionsService', ['getPacketById']);
    questions.getPacketById.and.returnValue(of({ id: 'packet-9', name: 'Regionals' } as unknown as Packet));
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [GameConfigComponent],
      providers: [
        { provide: GameStateService, useValue: gameStateService },
        { provide: GameMessageService, useValue: { gameEventObservables: { ProcessError: of(null) } } },
        { provide: SockbowlQuestionsService, useValue: questions },
        { provide: MatDialog, useValue: jasmine.createSpyObj<MatDialog>('MatDialog', ['open']) },
        { provide: MatSnackBar, useValue: snack },
        { provide: PresentationConnectionService, useValue: { isAvailable$: of(false), connectionState$: of(null) } },
        { provide: CastStateService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    component = TestBed.createComponent(GameConfigComponent).componentInstance;
    pendingPacketService = TestBed.inject(PendingPacketService);
  }

  afterEach(() => pendingPacketService?.clear());

  it('as the owner in a proctorless mode, sets the pending packet once and clears it', () => {
    configure();
    pendingPacketService.set('packet-9');
    gameStateService.isSelfProctor.and.returnValue(false);
    gameStateService.isProctorless.and.returnValue(true);
    gameStateService.isCurrentPlayerGameOwner.and.returnValue(true);

    component.ngOnInit();
    session$.next(configSession());

    expect(gameStateService.setMatchPacket).toHaveBeenCalledOnceWith('packet-9');
    expect(pendingPacketService.get()).toBeNull();

    // A later session update (e.g. the echo of our own change) must not re-fire it.
    session$.next(configSession());
    expect(gameStateService.setMatchPacket).toHaveBeenCalledTimes(1);
  });

  it('the proctor may also set the pending packet', () => {
    configure();
    pendingPacketService.set('packet-9');
    gameStateService.isSelfProctor.and.returnValue(true);
    gameStateService.isProctorless.and.returnValue(false);
    gameStateService.isCurrentPlayerGameOwner.and.returnValue(false);

    component.ngOnInit();
    session$.next(configSession());

    expect(gameStateService.setMatchPacket).toHaveBeenCalledOnceWith('packet-9');
  });

  it('a non-owner in a proctorless mode does not set the pending packet', () => {
    configure();
    pendingPacketService.set('packet-9');
    gameStateService.isSelfProctor.and.returnValue(false);
    gameStateService.isProctorless.and.returnValue(true);
    gameStateService.isCurrentPlayerGameOwner.and.returnValue(false);

    component.ngOnInit();
    session$.next(configSession());

    expect(gameStateService.setMatchPacket).not.toHaveBeenCalled();
    // Left in place so a player who does gain manage rights later can still apply it.
    expect(pendingPacketService.get()).toBe('packet-9');
  });

  it('does nothing when there is no pending packet', () => {
    configure();
    gameStateService.isSelfProctor.and.returnValue(true);

    component.ngOnInit();
    session$.next(configSession());

    expect(gameStateService.setMatchPacket).not.toHaveBeenCalled();
  });

  it('waits for CONFIG before applying the pending packet', () => {
    configure();
    pendingPacketService.set('packet-9');
    gameStateService.isSelfProctor.and.returnValue(true);

    component.ngOnInit();
    session$.next({
      gameSettings: {}, currentMatch: { matchState: MatchState.IN_GAME, packet: null }, teamList: [], playerList: [],
    } as unknown as GameSession);

    expect(gameStateService.setMatchPacket).not.toHaveBeenCalled();
    expect(pendingPacketService.get()).toBe('packet-9');
  });

  describe('confirmation snackbar follows the game echo, not the questions fetch (NG-V1-06)', () => {
    it('does not show "selected" merely because setMatchPacket was called', () => {
      configure();
      pendingPacketService.set('packet-9');
      gameStateService.isSelfProctor.and.returnValue(true);

      component.ngOnInit();
      session$.next(configSession());

      expect(gameStateService.setMatchPacket).toHaveBeenCalledOnceWith('packet-9');
      // The old behavior fired this off a separate getPacketById call, regardless
      // of whether the game ever actually accepted the pick.
      expect(questions.getPacketById).not.toHaveBeenCalled();
      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());
    });

    it('shows "Packet \'<name>\' selected." once the session echoes the same packet id back', () => {
      configure();
      pendingPacketService.set('packet-9');
      gameStateService.isSelfProctor.and.returnValue(true);

      component.ngOnInit();
      session$.next(configSession());
      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());

      // The game's own MatchPacketUpdate echo, carried on the next session.
      session$.next({
        gameSettings: {},
        currentMatch: { matchState: MatchState.CONFIG, packet: { id: 'packet-9', name: 'Regionals' } },
        teamList: [],
        playerList: [],
      } as unknown as GameSession);

      expect(snack.open).toHaveBeenCalledWith("Packet 'Regionals' selected.", 'OK', jasmine.anything());
      expect(questions.getPacketById).not.toHaveBeenCalled();
    });

    it('never confirms an unrelated packet id landing on the session', () => {
      configure();
      pendingPacketService.set('packet-9');
      gameStateService.isSelfProctor.and.returnValue(true);

      component.ngOnInit();
      session$.next(configSession());

      // Some other packet (e.g. another proctor's own pick) lands first.
      session$.next({
        gameSettings: {},
        currentMatch: { matchState: MatchState.CONFIG, packet: { id: 'packet-other', name: 'Someone else\'s packet' } },
        teamList: [],
        playerList: [],
      } as unknown as GameSession);

      expect(snack.open).not.toHaveBeenCalledWith(jasmine.stringMatching(/selected/), 'OK', jasmine.anything());
    });
  });
});
