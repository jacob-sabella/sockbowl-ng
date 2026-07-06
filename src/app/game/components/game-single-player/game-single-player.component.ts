import {Component, OnInit} from '@angular/core';
import {GameSession, RoundState} from '../../models/sockbowl/sockbowl-interfaces';
import {GameStateService} from '../../services/game-state.service';

/**
 * Solo play surface: the lone player reads the tossup, types an answer, and the
 * server-side judge adjudicates it (no proctor). On completion the answer is
 * revealed with a correct/incorrect verdict and a Next control.
 */
@Component({
  selector: 'app-game-single-player',
  templateUrl: './game-single-player.component.html',
  styleUrls: ['./game-single-player.component.scss'],
  standalone: false
})
export class GameSinglePlayerComponent implements OnInit {

  protected readonly RoundState = RoundState;

  gameSession!: GameSession;
  answerText = '';

  constructor(public gameStateService: GameStateService) {}

  ngOnInit(): void {
    this.gameStateService.gameSession$.subscribe(gameSession => (this.gameSession = gameSession));
  }

  get round(): any {
    return this.gameSession?.currentMatch?.currentRound;
  }

  get isCompleted(): boolean {
    return this.round?.roundState === RoundState.COMPLETED;
  }

  get canSubmit(): boolean {
    const state = this.round?.roundState;
    return (state === RoundState.AWAITING_BUZZ || state === RoundState.PROCTOR_READING)
      && this.answerText.trim().length > 0;
  }

  private get lastBuzz(): any {
    const buzzes = this.round?.buzzList;
    return buzzes && buzzes.length ? buzzes[buzzes.length - 1] : null;
  }

  get wasCorrect(): boolean {
    return !!this.lastBuzz?.correct;
  }

  submit(): void {
    if (!this.canSubmit) {
      return;
    }
    this.gameStateService.sendSubmitAnswer(this.answerText.trim());
    this.answerText = '';
  }

  next(): void {
    this.gameStateService.sendAdvanceRound();
  }
}
