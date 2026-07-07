import {Component, OnInit} from '@angular/core';
import {Observable} from 'rxjs';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

@Component({
    selector: 'app-game-buzzer',
    templateUrl: './game-buzzer.component.html',
    styleUrls: ['./game-buzzer.component.scss'],
    standalone: false
})
export class GameBuzzerComponent implements OnInit {

  protected readonly RoundState = RoundState;

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;
    });
  }

  /**
   * Gets the tossup timer display value from server.
   */
  getTossupTimerDisplay(): number | null {
    return this.gameSession?.currentMatch?.currentRound?.remainingTossupTimerSeconds ?? null;
  }

  /**
   * Gets the bonus timer display value from server.
   */
  getBonusTimerDisplay(): number | null {
    return this.gameSession?.currentMatch?.currentRound?.remainingBonusTimerSeconds ?? null;
  }

  getBuzzButtonText(): string {
    return this.gameStateService.hasCurrentPlayerTeamBuzzed() ? 'Team already buzzed' : 'Buzz!';
  }

  /**
   * Descriptive accessible label for the buzz button, reflecting its enabled or locked state.
   */
  getBuzzButtonAriaLabel(): string {
    return this.gameStateService.hasCurrentPlayerTeamBuzzed()
      ? 'Buzzer locked. Your team has already buzzed in.'
      : 'Buzz in to answer the tossup';
  }

  getCurrentBonusPart(bonus: any, partIndex: number): any {
    if (!bonus || !bonus.bonusParts || partIndex === undefined || partIndex === null) {
      return null;
    }

    return bonus.bonusParts[partIndex];
  }

  getBonusEligibleTeamName(): string {
    const teamId = this.gameSession?.currentMatch?.currentRound?.bonusEligibleTeamId;
    return teamId ? (this.gameStateService.getTeamNameById(teamId) || '') : '';
  }

}
