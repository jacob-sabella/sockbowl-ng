import { Injectable, inject } from '@angular/core';
import {ReplaySubject, Observable} from 'rxjs';
import {filter, tap} from 'rxjs/operators';
import {MatSnackBar} from '@angular/material/snack-bar';
import {GameMessageService} from './game-message.service';
import { GameMode,
  AdvanceRound,
  AnswerOutcome,
  AnswerUpdate,
  BonusPartOutcome,
  BonusUpdate,
  EndMatch,
  FinishedReading,
  FinishedReadingBonusPart,
  FinishedReadingBonusPreamble,
  GameSession,
  GameSessionUpdate,
  GameSettings,
  GameStartedMessage,
  MatchPacketUpdate,
  MatchState,
  Player,
  PlayerBuzzed,
  PlayerIncomingBuzz,
  SubmitAnswer,
  PlayerMode,
  PlayerRosterUpdate,
  ProcessError,
  ReadingUpdate,
  RoundUpdate,
  SetMatchPacket,
  SetProctor,
  StartBonus,
  StartMatch,
  Team,
  TimeoutBonusPart,
  TimeoutRound,
  TimerUpdate,
  UpdateGameSettings,
  UpdatePlayerTeam,
  StompError,
  SockbowlInMessage,
  Packet,
  processErrorMessage
} from '../models/sockbowl/sockbowl-interfaces';
import {SocketCredentials} from './game-web-socket.service';

@Injectable({
  providedIn: 'root'
})
export class GameStateService {
  private gameMessageService = inject(GameMessageService);
  private snackBar = inject(MatSnackBar);

  private _playerSessionId = '';

  get playerSessionId(): string {
    return this._playerSessionId;
  }

  // Initialize the GameSession state
  private gameSessionState: GameSession = {} as GameSession;

  // Create a ReplaySubject to hold the current state (only emits after first update)
  private gameSessionSubject = new ReplaySubject<GameSession>(1);

  // Expose the current state as an Observable
  public gameSession$: Observable<GameSession> = this.gameSessionSubject.asObservable();

  private messagesSubscribed = false;

  /**
   * The counts from the last MatchPacketUpdate. A non-proctor's copy of the
   * session carries no questions and (after WP-FIXG5) no packet id, so a
   * session resend would otherwise lose the tossup and bonus counts that only
   * MatchPacketUpdate carries.
   */
  private packetCounts: { name: string | null; tossupCount: number; bonusCount: number } | null = null;

  /** STOMP errors from the game socket (see GameWebSocketService.errors$). */
  public get errors$(): Observable<StompError> {
    return this.gameMessageService.errors$;
  }

  /**
   * Connects to a game seat.
   *
   * @param gameSessionId the game session
   * @param playerSessionId the player's seat
   * @param credentials `playerSecret` for a guest seat; empty for a seat bound
   *   to the signed-in account. Never pass an access token here: the socket
   *   asks AuthService for a fresh one at every CONNECT.
   */
  public initialize(gameSessionId: string, playerSessionId: string, credentials: SocketCredentials = {}) {
    this._playerSessionId = playerSessionId;
    // This service is a singleton (providedIn: 'root'), so a fresh seat must
    // not inherit the previous seat's MatchPacketUpdate counts (NG-R4-02).
    this.packetCounts = null;
    this.gameMessageService.initialize(gameSessionId, playerSessionId, credentials);
    if (!this.messagesSubscribed) {
      this.messagesSubscribed = true;
      this.subscribeToGameMessages();
    }
  }

  /**
   * Call when the player leaves the current game (e.g. GameCanvasComponent's
   * ngOnDestroy), so the counts from the game just left can't be restored
   * onto a later resend for a same-named packet in whatever comes next
   * (NG-R4-02). `initialize` also clears this for the next seat; this covers
   * the gap between leaving one and initializing another.
   */
  public leaveGame(): void {
    this.packetCounts = null;
  }

  /**
   * Ask the server to resend the full session state. The server sanitizes it
   * for this seat, so a proctor gets the full packet (with answers) this way
   * instead of reading it from the questions service (D2).
   */
  public requestGameSession(): void {
    this.gameMessageService.sendMessage('/app/game/config/get-game', new SockbowlInMessage());
  }


  /**
   * Put the last MatchPacketUpdate's counts back on a resent session whose
   * packet has no questions (a non-proctor's sanitized view), when it is
   * still the same packet (same name).
   */
  private restorePacketCounts(): void {
    const packet = this.gameSessionState?.currentMatch?.packet;
    const counts = this.packetCounts;
    if (!packet || !counts || !packet.name || packet.name !== counts.name) return;
    if (!Array.isArray(packet.tossups)) packet.tossups = new Array(counts.tossupCount);
    if (!Array.isArray(packet.bonuses)) packet.bonuses = new Array(counts.bonusCount);
  }

  // ----------------------
  // Messaging
  // ----------------------

  /**
   * Setup subscriptions to messages from sockbowl-game and act on updating the state
   * @private
   */
  private subscribeToGameMessages(): void {

    // Subscribe to GameSessionUpdate messages
    this.gameMessageService.gameEventObservables["GameSessionUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: GameSessionUpdate) => {
          this.gameSessionState = msg.gameSession;
          this.restorePacketCounts();
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to PlayerRosterUpdate messages
    this.gameMessageService.gameEventObservables["PlayerRosterUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: PlayerRosterUpdate) => {
          this.gameSessionState.playerList = msg.playerList;
          this.gameSessionState.teamList = msg.teamList;
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to GameStartedMessage messages to mark game as started
    this.gameMessageService.gameEventObservables["GameStartedMessage"]
      .pipe(
        filter(msg => !!msg),
        tap((_msg: GameStartedMessage) => {
          this.gameSessionState.currentMatch.matchState = MatchState.IN_GAME;
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to MatchPacketUpdate message and update the match packet details
    this.gameMessageService.gameEventObservables["MatchPacketUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: MatchPacketUpdate) => {
          const match = this.gameSessionState.currentMatch;
          if (!match) return;
          if (!match.packet) match.packet = {} as Packet;
          // Only the proctor (or the owner in a proctorless mode) is sent the
          // packet id (WP-FIXG5); everyone else gets null plus the metadata.
          match.packet.id = msg.packetId ?? (null as unknown as string);
          match.packet.name = msg.packetName as string;
          // Clients aren't sent the questions (anti-spoiler); keep length-only
          // arrays so "Tossup N of M" progress can read packet.tossups.length
          // and the config screen can read the bonus count.
          match.packet.tossups = new Array(msg.tossupCount || 0);
          match.packet.bonuses = new Array(msg.bonusCount || 0);
          this.packetCounts = msg.packetName || msg.tossupCount
            ? { name: msg.packetName, tossupCount: msg.tossupCount || 0, bonusCount: msg.bonusCount || 0 }
            : null;
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to ProcessError and show error toast
    this.gameMessageService.gameEventObservables["ProcessError"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: ProcessError) => {
          console.error('ProcessError:', msg);
          // Show error message in toast
          this.snackBar.open(processErrorMessage(msg), 'Dismiss', {
            duration: 5000,
            panelClass: ['error-snackbar'],
            horizontalPosition: 'center',
            verticalPosition: 'top'
          });
        })
      )
      .subscribe();

    // Subscribe to CorrectAnswer message and update the current round for the new state
    this.gameMessageService.gameEventObservables["AnswerUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: AnswerUpdate) => {

          // Update the current round to the new round
          this.gameSessionState.currentMatch.currentRound = msg.currentRound;
          this.gameSessionState.currentMatch.previousRounds = msg.previousRounds;

          // Emit the updated game session state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    this.gameMessageService.gameEventObservables["RoundUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: RoundUpdate) => {

          // Update the current round to the new round
          this.gameSessionState.currentMatch.currentRound = msg.round;
          this.gameSessionState.currentMatch.previousRounds = msg.previousRounds;

          // Emit the updated game session state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();


    this.gameMessageService.gameEventObservables["PlayerBuzzed"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: PlayerBuzzed) => {
          this.gameSessionState.currentMatch.currentRound = msg.round;
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to BonusUpdate messages
    this.gameMessageService.gameEventObservables["BonusUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: BonusUpdate) => {
          // Update the current round with bonus information
          this.gameSessionState.currentMatch.currentRound = msg.currentRound;
          this.gameSessionState.currentMatch.previousRounds = msg.previousRounds;

          // Emit the updated game session state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to TimerUpdate messages
    this.gameMessageService.gameEventObservables["TimerUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: TimerUpdate) => {
          // Guard the round: a stray/late timer tick can arrive while currentRound is
          // null (round transition, or a tick in flight after the round completed). An
          // NPE thrown here would terminate this subscription permanently — no more
          // timer updates for the rest of the session.
          const round = this.gameSessionState?.currentMatch?.currentRound;
          if (!round) {
            return;
          }
          // Update the timer state in the current round
          if (msg.timerType === 'TOSSUP') {
            round.remainingTossupTimerSeconds = msg.remainingSeconds;
          } else if (msg.timerType === 'BONUS') {
            round.remainingBonusTimerSeconds = msg.remainingSeconds;
          }

          // Emit updated state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to ReadingUpdate messages (AUTO_PROCTOR server-driven reveal)
    this.gameMessageService.gameEventObservables["ReadingUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: ReadingUpdate) => {
          // Guard the round like the TimerUpdate handler: an NPE here would kill the
          // subscription and freeze the server-driven reveal for the rest of the game.
          const round = this.gameSessionState?.currentMatch?.currentRound;
          if (!round) {
            return;
          }
          // The revealed text IS the round's question for AUTO_PROCTOR, the server
          // never sends unrevealed text, so just replace it directly.
          round.question = msg.revealedText;
          round.revealedWordCount = msg.revealedWordCount;
          round.totalWordCount = msg.totalWordCount;

          // Emit updated state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

  }

  /**
   * Update the team for the player registered in the state
   * @param targetTeam Team current player should be on
   */
  public updateTeamSelf(targetTeam: string) {

    const updatePlayerTeam: UpdatePlayerTeam = new UpdatePlayerTeam({
      targetPlayer: this._playerSessionId,
      targetTeam: targetTeam
    });

    this.gameMessageService.sendMessage("/app/game/config/update-player-team", updatePlayerTeam)
  }

  /**
   * Set current player id as proctor
   */
  public setSelfProctor() {
    const setProctor: SetProctor = new SetProctor({
      targetPlayer: this._playerSessionId
    });
    this.gameMessageService.sendMessage("/app/game/config/set-proctor", setProctor);
  }

  /**
   * Sets the match packet to the specified packet ID.
   * @param packetId The ID of the packet to set.
   */
  public setMatchPacket(packetId: string): void {
    const setMatchPacket: SetMatchPacket = new SetMatchPacket({
      packetId: packetId
    });

    this.gameMessageService.sendMessage("/app/game/config/set-match-packet", setMatchPacket);
  }


  public startMatch(): void {
    const startMatch: StartMatch = new StartMatch({});
    this.gameMessageService.sendMessage("/app/game/progression/start-match", startMatch);
  }

  /**
   * Ends the match
   */
  public endMatch(): void {
    const endMatch: EndMatch = new EndMatch({});
    this.gameMessageService.sendMessage("/app/game/progression/end-match", endMatch);
  }

  /**
   * Sends an AnswerOutcome message with correct set to true.
   */
  public sendAnswerCorrect(): void {
    const answerCorrect = new AnswerOutcome({correct: true});
    this.gameMessageService.sendMessage(`/app/game/answer-outcome`, answerCorrect);
  }

  /**
   * Sends an AnswerOutcome message with correct set to false.
   */
  public sendAnswerIncorrect(): void {
    const answerIncorrect = new AnswerOutcome({correct: false});
    this.gameMessageService.sendMessage(`/app/game/answer-outcome`, answerIncorrect);
  }

  /**
   * Sends a FinishedReading message.
   */
  public sendFinishedReading(): void {
    const finishedReading = new FinishedReading({});
    this.gameMessageService.sendMessage(`/app/game/finished-reading`, finishedReading);
  }

  /**
   * Sends a PlayerIncomingBuzz message.
   */
  public sendPlayerIncomingBuzz(): void {
    const playerIncomingBuzz = new PlayerIncomingBuzz({});
    this.gameMessageService.sendMessage(`/app/game/player-incoming-buzz`, playerIncomingBuzz);
  }

  /**
   * Sends a SubmitAnswer message (single-player typed answer).
   */
  public sendSubmitAnswer(answerText: string): void {
    const submitAnswer = new SubmitAnswer({ answerText } as SubmitAnswer);
    this.gameMessageService.sendMessage(`/app/game/submit-answer`, submitAnswer);
  }

  /**
   * Sends a TimeoutRound message.
   */
  public sendTimeoutRound(): void {
    const timeoutRound = new TimeoutRound({});
    this.gameMessageService.sendMessage(`/app/game/timeout-round`, timeoutRound);
  }

  /**
   * Sends a AdvanceRound message.
   */
  public sendAdvanceRound(): void {
    const advanceRound = new AdvanceRound({});
    this.gameMessageService.sendMessage(`/app/game/advance-round`, advanceRound);
  }

  /**
   * Sends a FinishedReadingBonusPreamble message.
   */
  public sendFinishedReadingBonusPreamble(): void {
    const finishedReadingBonusPreamble = new FinishedReadingBonusPreamble({});
    this.gameMessageService.sendMessage(`/app/game/finished-reading-bonus-preamble`, finishedReadingBonusPreamble);
  }

  /**
   * Sends a FinishedReadingBonusPart message.
   */
  public sendFinishedReadingBonusPart(): void {
    const finishedReadingBonusPart = new FinishedReadingBonusPart({});
    this.gameMessageService.sendMessage(`/app/game/finished-reading-bonus-part`, finishedReadingBonusPart);
  }

  /**
   * Sends a TimeoutBonusPart message.
   */
  public sendTimeoutBonusPart(): void {
    const timeoutBonusPart = new TimeoutBonusPart({});
    this.gameMessageService.sendMessage(`/app/game/timeout-bonus-part`, timeoutBonusPart);
  }

  /**
   * Sends a StartBonus message.
   */
  public sendStartBonus(): void {
    const startBonus = new StartBonus({});
    this.gameMessageService.sendMessage(`/app/game/start-bonus`, startBonus);
  }

  /**
   * Sends a BonusPartOutcome message.
   * @param partIndex Which bonus part (0, 1, or 2)
   * @param correct Whether the answer was correct
   */
  public sendBonusPartOutcome(partIndex: number, correct: boolean): void {
    const bonusPartOutcome = new BonusPartOutcome({
      partIndex: partIndex,
      correct: correct
    });
    this.gameMessageService.sendMessage(`/app/game/bonus-part-outcome`, bonusPartOutcome);
  }

  /**
   * Updates game settings including bonuses enabled flag.
   * @param gameSettings The updated game settings
   */
  public updateGameSettings(gameSettings: GameSettings): void {
    const updateGameSettings = new UpdateGameSettings({
      gameSettings: gameSettings
    });
    this.gameMessageService.sendMessage(`/app/game/config/update-game-settings`, updateGameSettings);
  }

  /**
   * Calculates total bonus points for current round.
   * @returns Total bonus points earned so far (10 per correct part)
   */
  public getCurrentRoundBonusPoints(): number {
    const round = this.gameSessionState?.currentMatch?.currentRound;
    if (!round || !round.bonusPartAnswers) return 0;

    return round.bonusPartAnswers
      .filter(answer => answer.correct)
      .length * 10;
  }

  /**
   * The maximum a bonus can score (10 per part). A packet's bonuses can have
   * 1 to 6 parts (D7), not always 3 (the ng minors item alongside NG-V1-02),
   * so this reads the current round's actual bonus rather than assuming 3
   * parts / 30 points. Falls back to the classic 3-part default (30) only
   * when no bonus is in play yet, so the label has something to show before
   * `currentBonus` arrives on the wire.
   * @returns The current bonus's max score, or 30 if none is active
   */
  public getCurrentRoundMaxBonusPoints(): number {
    const round = this.gameSessionState?.currentMatch?.currentRound;
    const partCount = round?.currentBonus?.bonusParts?.length;
    return (partCount && partCount > 0 ? partCount : 3) * 10;
  }


  // ----------------------
  // State Querying
  // ----------------------

  /**
   * Checks if a player is on any team.
   * @param playerId The ID of the player to check.
   * @returns true if the player is on any team; otherwise false.
   */
  isPlayerOnAnyTeam(playerId: string): boolean {
    return this.gameSessionState.teamList.some(team => team.teamPlayers.some(player => player.playerId === playerId));
  }

  /**
   * Checks if the current player is on any team.
   * @returns true if the current player is on any team; otherwise false.
   */
  isSelfOnAnyTeam(): boolean {
    return this.gameSessionState.teamList.some(team => team.teamPlayers.some(player => player.playerId === this._playerSessionId));
  }

  /**
   * Checks if the current player is on a specific team.
   * @param teamId The ID of the team to check.
   * @returns true if the current player is on the specified team; otherwise false.
   */
  isSelfOnTeam(teamId: string): boolean {
    const currentPlayerId = this._playerSessionId;
    const team = this.gameSessionState.teamList.find(team => team.teamId === teamId);
    return team ? team.teamPlayers.some(player => player.playerId === currentPlayerId) : false;
  }

  /**
   * Gets the player who is currently the proctor.
   * @returns The player who is the proctor, or undefined if there is no proctor.
   */
  getProctor(): Player | undefined {
    return this.gameSessionState.playerList.find(player => player.playerMode === PlayerMode.PROCTOR);
  }

  /**
   * Determines if the current player is the proctor.
   * @returns true if the current player is the proctor; otherwise false.
   */
  isSelfProctor(): boolean {
    const proctor = this.getProctor();
    return !!proctor && proctor.playerId === this._playerSessionId;
  }

  /**
   * Checks if the current player is the game owner.
   * @returns true if the current player is the game owner; otherwise false.
   */
  public isCurrentPlayerGameOwner(): boolean {
    return this.gameSessionState.playerList.some(player => player.gameOwner &&
      player.playerId === this._playerSessionId);
  }

  /**
   * Checks if the current player is a spectator.
   * @returns true if the current player is in SPECTATOR mode; otherwise false.
   */
  public isSelfSpectator(): boolean {
    const currentPlayer = this.getCurrentPlayer();
    return currentPlayer?.playerMode === PlayerMode.SPECTATOR;
  }

  /**
   * Get state of current match
   */
  public getMatchState(): MatchState {
    return this.gameSessionState.currentMatch.matchState;
  }

  /**
   * Whether the current game is single-player (auto-judged, no proctor).
   */
  public isSinglePlayer(): boolean {
    return this.gameSessionState?.gameSettings?.gameMode === GameMode.SINGLE_PLAYER;
  }

  /** Whether the current game is auto-proctor multiplayer (teams + buzzers, no proctor). */
  public isAutoProctor(): boolean {
    return this.gameSessionState?.gameSettings?.gameMode === GameMode.AUTO_PROCTOR;
  }

  /** Whether the current game is free-for-all (one-player teams, auto-judged, no proctor). */
  public isFreeForAll(): boolean {
    return this.gameSessionState?.gameSettings?.gameMode === GameMode.FREE_FOR_ALL;
  }

  /** Auto-judged multiplayer modes (team-based auto-proctor and one-seat-per-team free-for-all). */
  public isAutoJudgedMultiplayer(): boolean {
    return this.isAutoProctor() || this.isFreeForAll();
  }

  /** Modes with no human proctor. */
  public isProctorless(): boolean {
    return this.isSinglePlayer() || this.isAutoJudgedMultiplayer();
  }

  /**
   * Gets the current player's information.
   */
  getCurrentPlayer(): Player | undefined {
    return this.gameSessionState.playerList.find(player => player.playerId === this._playerSessionId);
  }

  /**
   * Gets the team information for the current player.
   */
  getCurrentPlayerTeam(): Team | undefined {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer) return undefined;
    return this.gameSessionState.teamList.find(team => team.teamPlayers.some(player => player.playerId === currentPlayer.playerId));
  }

  /**
   * Checks if the current player's team has already buzzed in the current round.
   */
  hasCurrentPlayerTeamBuzzed(): boolean {
    const currentTeam = this.getCurrentPlayerTeam();
    if (!currentTeam) return false;
    const currentRound = this.gameSessionState.currentMatch.currentRound;
    return currentRound.buzzList.some(buzz => buzz.teamId === currentTeam.teamId);
  }


  /**
   * Retrieves a player's name based on their ID.
   * @param playerId The ID of the player.
   * @returns The name of the player, or undefined if not found.
   */
  getPlayerNameById(playerId: string): string | undefined {
    const player = this.gameSessionState.playerList.find(p => p.playerId === playerId);
    return player?.name;
  }

  /**
   * Retrieves a team's name based on its ID.
   * @param teamId The ID of the team.
   * @returns The name of the team, or undefined if not found.
   */
  getTeamNameById(teamId: string): string | undefined {
    const team = this.gameSessionState.teamList.find(t => t.teamId === teamId);
    return team?.teamName;
  }

}
