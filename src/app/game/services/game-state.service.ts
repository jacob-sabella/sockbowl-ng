import {Injectable} from '@angular/core';
import {ReplaySubject, Observable} from 'rxjs';
import {filter, tap} from 'rxjs/operators';
import {GameMessageService} from './game-message.service';
import {
  AdvanceRound,
  AnswerOutcome,
  AnswerUpdate,
  BonusPartOutcome,
  BonusUpdate,
  EndMatch,
  FinishedReading,
  GameSession,
  GameSessionUpdate,
  GameSettings,
  GameStartedMessage,
  MatchPacketUpdate,
  MatchState,
  Player,
  PlayerBuzzed,
  PlayerIncomingBuzz,
  PlayerMode,
  PlayerRosterUpdate,
  ProcessError,
  RoundUpdate,
  SetMatchPacket,
  SetProctor,
  StartMatch,
  Team,
  TimeoutRound,
  UpdateGameSettings,
  UpdatePlayerTeam
} from '../models/sockbowl/sockbowl-interfaces';

@Injectable({
  providedIn: 'root'
})
export class GameStateService {
  private _playerSessionId: string = '';

  get playerSessionId(): string {
    return this._playerSessionId;
  }

  // Initialize the GameSession state
  private gameSessionState: GameSession = {} as GameSession;

  // Create a ReplaySubject to hold the current state (only emits after first update)
  private gameSessionSubject: ReplaySubject<GameSession> = new ReplaySubject(1);

  // Expose the current state as an Observable
  public gameSession$: Observable<GameSession> = this.gameSessionSubject.asObservable();

  constructor(private gameMessageService: GameMessageService) {
  }

  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string, accessToken?: string) {
    this._playerSessionId = playerSessionId;
    this.gameMessageService.initialize(gameSessionId, playerSecret, playerSessionId, accessToken);
    this.subscribeToGameMessages();
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
          console.log(msg.gameSession);
          this.gameSessionState = msg.gameSession;
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
        tap((msg: GameStartedMessage) => {
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
          this.gameSessionState.currentMatch.packet.id = msg.packetId;
          this.gameSessionState.currentMatch.packet.name = msg.packetName;
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to ProcessError and output error to console log
    this.gameMessageService.gameEventObservables["ProcessError"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: ProcessError) => {
          console.log(msg)
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

  }

  /**
   * Update the team for the player registered in the state
   * @param targetTeam Team current player should be on
   */
  public updateTeamSelf(targetTeam: string) {

    let updatePlayerTeam: UpdatePlayerTeam = new UpdatePlayerTeam({
      targetPlayer: this._playerSessionId,
      targetTeam: targetTeam
    });

    this.gameMessageService.sendMessage("/app/game/config/update-player-team", updatePlayerTeam)
  }

  /**
   * Set current player id as proctor
   */
  public setSelfProctor() {
    let setProctor: SetProctor = new SetProctor({
      targetPlayer: this._playerSessionId
    });
    this.gameMessageService.sendMessage("/app/game/config/set-proctor", setProctor);
  }

  /**
   * Sets the match packet to the specified packet ID.
   * @param packetId The ID of the packet to set.
   */
  public setMatchPacket(packetId: String): void {
    let setMatchPacket: SetMatchPacket = new SetMatchPacket({
      packetId: packetId
    });

    this.gameMessageService.sendMessage("/app/game/config/set-match-packet", setMatchPacket);
  }


  public startMatch(): void {
    let startMatch: StartMatch = new StartMatch({});
    this.gameMessageService.sendMessage("/app/game/progression/start-match", startMatch);
  }

  /**
   * Ends the match
   */
  public endMatch(): void {
    let endMatch: EndMatch = new EndMatch({});
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
   * @returns Total bonus points earned (0-30)
   */
  public getCurrentRoundBonusPoints(): number {
    const round = this.gameSessionState?.currentMatch?.currentRound;
    if (!round || !round.bonusPartAnswers) return 0;

    return round.bonusPartAnswers
      .filter(answer => answer.correct)
      .length * 10;
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
