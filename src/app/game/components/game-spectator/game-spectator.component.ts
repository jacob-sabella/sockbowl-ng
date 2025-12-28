import { Component, OnInit, OnDestroy } from '@angular/core';
import { GameStateService } from '../../services/game-state.service';
import { GameSession, Round, RoundState, Team } from '../../models/sockbowl/sockbowl-interfaces';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-game-spectator',
    templateUrl: './game-spectator.component.html',
    styleUrls: ['./game-spectator.component.scss'],
    standalone: false
})
export class GameSpectatorComponent implements OnInit, OnDestroy {
  gameSession: GameSession | null = null;
  currentRound: Round | null = null;
  previousRounds: Round[] = [];
  teams: Team[] = [];

  RoundState = RoundState;

  private gameSessionSubscription?: Subscription;

  constructor(public gameStateService: GameStateService) {}

  ngOnInit(): void {
    this.gameSessionSubscription = this.gameStateService.gameSession$.subscribe(gameSession => {
      if (gameSession) {
        this.gameSession = gameSession;
        this.currentRound = gameSession.currentMatch?.currentRound || null;
        this.previousRounds = gameSession.currentMatch?.previousRounds || [];
        this.teams = gameSession.teamList || [];
      }
    });
  }

  ngOnDestroy(): void {
    this.gameSessionSubscription?.unsubscribe();
  }

  /**
   * Check if current round answer should be visible
   * Answer is visible when round is complete
   */
  isAnswerVisible(): boolean {
    if (!this.currentRound) return false;
    return this.currentRound.roundState === RoundState.COMPLETED;
  }

  /**
   * Get the team name for a given team ID
   */
  getTeamName(teamId: string): string {
    const team = this.teams.find(t => t.teamId === teamId);
    return team?.teamName || 'Unknown Team';
  }

  /**
   * Calculate team score based on correct buzzes
   */
  getTeamScore(team: Team): number {
    return team.teamPlayers.reduce((total, player) => total + this.getPlayerScore(player.playerId), 0);
  }

  /**
   * Calculate player score from all rounds (10 points per correct buzz)
   */
  getPlayerScore(playerId: string): number {
    let score = 0;

    // Calculate score from previous rounds
    this.previousRounds.forEach(round => {
      score += round.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    });

    // Add score from current round if it exists
    if (this.currentRound) {
      score += this.currentRound.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    }

    return score;
  }

  /**
   * Get formatted round outcome message
   */
  getRoundOutcome(round: Round): string {
    if (!round.buzzList || round.buzzList.length === 0) {
      return 'No buzzes';
    }

    const lastBuzz = round.buzzList[round.buzzList.length - 1];
    const teamName = this.getTeamName(lastBuzz.teamId);

    if (lastBuzz.correct) {
      return `${teamName} answered correctly`;
    } else {
      return `${teamName} answered incorrectly`;
    }
  }

  /**
   * Check if a round has any buzzes
   */
  hasBuzzes(round: Round): boolean {
    return round.buzzList && round.buzzList.length > 0;
  }
}
