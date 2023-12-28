import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {filter, tap} from 'rxjs/operators';
import {GameMessageService} from './game-message.service';
import {
  AnswerCorrect,
  AnswerIncorrect,
  CorrectAnswer,
  FinishedReading,
  GameSession,
  GameSessionUpdate,
  GameStartedMessage,
  IncorrectAnswer,
  MatchPacketUpdate,
  MatchState,
  Player, PlayerBuzzed,
  PlayerIncomingBuzz,
  PlayerMode,
  PlayerRosterUpdate,
  ProcessError,
  RoundUpdate,
  SetMatchPacket,
  SetProctor,
  StartMatch, Team,
  TimeoutRound,
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

  // Create a BehaviorSubject to hold the current state
  private gameSessionSubject: BehaviorSubject<GameSession> = new BehaviorSubject(this.gameSessionState);

  // Expose the current state as an Observable
  public gameSession$: Observable<GameSession> = this.gameSessionSubject.asObservable();

  constructor(private gameMessageService: GameMessageService) {
  }

  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string) {
    this._playerSessionId = playerSessionId;
    this.gameMessageService.initialize(gameSessionId, playerSecret, playerSessionId);
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
    this.gameMessageService.gameEventObservables["CorrectAnswer"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: CorrectAnswer) => {
          // Check if the incoming round number is different from the current round number
          if (msg.currentRound.roundNumber !== this.gameSessionState.currentMatch.currentRound.roundNumber) {
            // Add the current round to the previous rounds list
            console.log(this.gameSessionState.currentMatch.previousRounds)
            this.gameSessionState.currentMatch.previousRounds.push(this.gameSessionState.currentMatch.currentRound);
            console.log(this.gameSessionState.currentMatch.previousRounds)
          }

          // Update the current round to the new round
          this.gameSessionState.currentMatch.currentRound = msg.currentRound;

          // Emit the updated game session state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    // Subscribe to IncorrectAnswer message and update the current round for the new state
    this.gameMessageService.gameEventObservables["IncorrectAnswer"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: IncorrectAnswer) => {
          // Check if the incoming round number is different from the current round number
          if (msg.currentRound.roundNumber !== this.gameSessionState.currentMatch.currentRound.roundNumber) {
            // Add the current round to the previous rounds list
            this.gameSessionState.currentMatch.previousRounds.push(this.gameSessionState.currentMatch.currentRound);
          }

          // Update the current round to the new round
          this.gameSessionState.currentMatch.currentRound = msg.currentRound;

          // Emit the updated game session state
          this.gameSessionSubject.next(this.gameSessionState);
        })
      )
      .subscribe();

    this.gameMessageService.gameEventObservables["RoundUpdate"]
      .pipe(
        filter(msg => !!msg),
        tap((msg: RoundUpdate) => {
          // Check if the incoming round number is different from the current round number
          if (msg.round.roundNumber !== this.gameSessionState.currentMatch.currentRound.roundNumber) {
            // Add the current round to the previous rounds list
            this.gameSessionState.currentMatch.previousRounds.push(this.gameSessionState.currentMatch.currentRound);
          }

          // Update the current round to the new round
          this.gameSessionState.currentMatch.currentRound = msg.round;

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
  public setMatchPacket(packetId: number): void {
    let setMatchPacket: SetMatchPacket = new SetMatchPacket({
      packetId: packetId
    });

    this.gameMessageService.sendMessage("/app/game/config/set-match-packet", setMatchPacket);
  }

  /**
   * Starts the match
   */
  public startMatch(): void {
    let startMatch: StartMatch = new StartMatch({});
    this.gameMessageService.sendMessage("/app/game/progression/start-match", startMatch);
  }

  /**
   * Sends an AnswerCorrect message.
   */
  public sendAnswerCorrect(): void {
    const answerCorrect = new AnswerCorrect({});
    this.gameMessageService.sendMessage(`/app/game/answer-correct`, answerCorrect);
  }

  /**
   * Sends an AnswerIncorrect message.
   */
  public sendAnswerIncorrect(): void {
    const answerIncorrect = new AnswerIncorrect({});
    this.gameMessageService.sendMessage(`/app/game/answer-incorrect`, answerIncorrect);
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
