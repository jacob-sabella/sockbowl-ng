import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, take } from 'rxjs/operators';
import { GameStateService } from './game-state.service';
import { PresentationConnectionService } from './presentation-connection.service';
import { CastGameState, CastBuzzInfo, CastTeamScore, CastTeamRoster, PresentationConnectionState } from '../models/cast-interfaces';
import { GameSession, Team, RoundState, MatchState } from '../models/sockbowl/sockbowl-interfaces';

/**
 * CastStateService
 *
 * Orchestrates the transformation and streaming of game state to the cast receiver.
 *
 * This service:
 * - Subscribes to GameStateService's gameSession$ observable
 * - Transforms full GameSession into minimal CastGameState
 * - Applies visibility rules based on round state
 * - Calculates team scores (tossup + bonus points)
 * - Throttles updates to prevent overwhelming the connection
 * - Sends updates via PresentationConnectionService when connected
 */
@Injectable({
  providedIn: 'root'
})
export class CastStateService implements OnDestroy {
  /** Subscription to game state updates */
  private gameSessionSubscription?: Subscription;

  /** Subscription to connection state updates */
  private connectionStateSubscription?: Subscription;

  /** Whether we're currently connected and should send updates */
  private isConnected = false;

  /** Track previous proctor state to detect when user loses proctor role */
  private wasSelfProctor = false;

  constructor(
    private gameStateService: GameStateService,
    private presentationConnectionService: PresentationConnectionService
  ) {
    this.initialize();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  /**
   * Initializes subscriptions to game state and connection state.
   */
  private initialize(): void {
    // Subscribe to connection state to know when to send updates
    this.connectionStateSubscription = this.presentationConnectionService.connectionState$
      .subscribe(state => {
        this.isConnected = state === PresentationConnectionState.CONNECTED;

        // If just connected, immediately send current state and initialize proctor tracking
        if (this.isConnected) {
          this.wasSelfProctor = this.gameStateService.isSelfProctor();
          this.gameStateService.gameSession$.pipe(take(1)).subscribe(gameSession => {
            if (gameSession) {
              this.sendState(gameSession);
            }
          });
        }
      });

    // Subscribe to game state changes and send to receiver when connected
    this.gameSessionSubscription = this.gameStateService.gameSession$
      .pipe(
        debounceTime(100), // Throttle updates to avoid spamming connection
        distinctUntilChanged((prev, curr) => {
          // Only send if relevant state has changed
          if (!prev || !curr) return false;

          const prevRound = prev.currentMatch?.currentRound;
          const currRound = curr.currentMatch?.currentRound;

          // Send if round changed or round state changed or buzz changed
          return prevRound?.roundNumber === currRound?.roundNumber &&
                 prevRound?.roundState === currRound?.roundState &&
                 prevRound?.currentBuzz?.playerId === currRound?.currentBuzz?.playerId &&
                 prevRound?.currentBuzz?.correct === currRound?.currentBuzz?.correct;
        })
      )
      .subscribe(gameSession => {
        if (this.isConnected && gameSession) {
          this.sendState(gameSession);
        }

        // Auto-stop casting if user loses proctor role
        const isSelfProctor = this.gameStateService.isSelfProctor();
        if (this.wasSelfProctor && !isSelfProctor && this.isConnected) {
          console.log('User is no longer proctor, stopping cast session');
          this.presentationConnectionService.stopPresentation();
        }
        this.wasSelfProctor = isSelfProctor;
      });
  }

  /**
   * Transforms and sends the current game state to the receiver.
   */
  private sendState(gameSession: GameSession): void {
    const castState = this.transformGameState(gameSession);
    this.presentationConnectionService.sendGameState(castState);
  }

  /**
   * Transforms full GameSession into minimal CastGameState for the receiver.
   * Applies visibility rules and calculates scores.
   */
  private transformGameState(gameSession: GameSession): CastGameState {
    const isConfigStage = gameSession.currentMatch.matchState === MatchState.CONFIG;

    if (isConfigStage) {
      // Config stage: show join code, teams, and game settings
      const teamRosters: CastTeamRoster[] = gameSession.teamList.map(team => ({
        teamId: team.teamId,
        teamName: team.teamName,
        playerNames: team.teamPlayers.map(player => player.name)
      }));

      return {
        messageType: 'GAME_STATE_UPDATE',
        timestamp: Date.now(),
        isConfigStage: true,
        joinCode: gameSession.joinCode,
        teamRosters,
        packetName: gameSession.currentMatch.packet?.name || undefined,
        gameMode: gameSession.gameSettings.gameMode || 'Standard',
        proctorName: this.gameStateService.getProctor()?.name || 'No proctor yet',
        // Required fields (not used in config stage but needed for type compatibility)
        roundNumber: 0,
        category: '',
        subcategory: '',
        roundState: RoundState.PROCTOR_READING,
        questionVisible: false,
        questionText: '',
        answerVisible: false,
        answerText: '',
        currentBuzz: null,
        teamScores: []
      };
    } else {
      // Active match: show round info, question, answer, buzzes, scores
      const currentRound = gameSession.currentMatch.currentRound;

      // Question visibility: hide during PROCTOR_READING
      const questionVisible = currentRound.roundState !== RoundState.PROCTOR_READING;

      // Answer visibility: show only when COMPLETED
      const answerVisible = currentRound.roundState === RoundState.COMPLETED;

      // Current buzz info
      const currentBuzz: CastBuzzInfo | null = currentRound.currentBuzz ? {
        playerName: this.gameStateService.getPlayerNameById(currentRound.currentBuzz.playerId) || 'Unknown',
        teamName: this.gameStateService.getTeamNameById(currentRound.currentBuzz.teamId) || 'Unknown',
        teamId: currentRound.currentBuzz.teamId,
        correct: currentRound.currentBuzz.correct
      } : null;

      // Calculate team scores
      const teamScores: CastTeamScore[] = gameSession.teamList.map(team => ({
        teamId: team.teamId,
        teamName: team.teamName,
        score: this.calculateTeamScore(team, gameSession)
      }));

      return {
        messageType: 'GAME_STATE_UPDATE',
        timestamp: Date.now(),
        isConfigStage: false,
        roundNumber: currentRound.roundNumber,
        category: currentRound.category || '',
        subcategory: currentRound.subcategory || '',
        roundState: currentRound.roundState,
        questionVisible,
        questionText: currentRound.question || '',
        answerVisible,
        answerText: currentRound.answer || '',
        currentBuzz,
        teamScores
      };
    }
  }

  /**
   * Calculates total score for a team (tossup points + bonus points).
   * Reuses scoring logic from TeamListComponent.
   */
  private calculateTeamScore(team: Team, gameSession: GameSession): number {
    // Calculate tossup points (10 points per correct buzz)
    const tossupScore = team.teamPlayers.reduce((total, player) => {
      let playerScore = 0;

      // Previous rounds
      gameSession.currentMatch.previousRounds.forEach(round => {
        const correctBuzzes = round.buzzList.filter(
          buzz => buzz.playerId === player.playerId && buzz.correct
        ).length;
        playerScore += correctBuzzes * 10;
      });

      // Current round
      const currentCorrectBuzzes = gameSession.currentMatch.currentRound.buzzList.filter(
        buzz => buzz.playerId === player.playerId && buzz.correct
      ).length;
      playerScore += currentCorrectBuzzes * 10;

      return total + playerScore;
    }, 0);

    // Calculate bonus points (10 points per correct bonus part)
    let bonusScore = 0;

    // Previous rounds bonuses
    gameSession.currentMatch.previousRounds.forEach(round => {
      if (round.bonusEligibleTeamId === team.teamId && round.bonusPartAnswers) {
        const correctParts = round.bonusPartAnswers.filter(answer => answer.correct).length;
        bonusScore += correctParts * 10;
      }
    });

    // Current round bonus
    const currentRound = gameSession.currentMatch.currentRound;
    if (currentRound.bonusEligibleTeamId === team.teamId && currentRound.bonusPartAnswers) {
      const correctParts = currentRound.bonusPartAnswers.filter(answer => answer.correct).length;
      bonusScore += correctParts * 10;
    }

    return tossupScore + bonusScore;
  }

  /**
   * Cleans up subscriptions when service is destroyed.
   */
  private cleanup(): void {
    this.gameSessionSubscription?.unsubscribe();
    this.connectionStateSubscription?.unsubscribe();
  }
}
