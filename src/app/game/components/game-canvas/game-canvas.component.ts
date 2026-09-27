import {Component, DestroyRef, inject, ChangeDetectionStrategy, OnInit} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute} from "@angular/router";
import {GameStateService} from "../../services/game-state.service";
import {Observable} from "rxjs";
import {GameSession, MatchState} from "../../models/sockbowl/sockbowl-interfaces";

@Component({
    selector: 'app-game-canvas',
    templateUrl: './game-canvas.component.html',
    styleUrls: ['./game-canvas.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameCanvasComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private gameStateService = inject(GameStateService);


  gameSession$: Observable<GameSession>;

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.gameSession$ = this.gameStateService.gameSession$;
  }

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {

      const gameSessionId: string = params.get("gameSessionId") || '';
      const playerSecret: string = params.get("playerSecret") || '';
      const playerSessionId: string = params.get("playerSessionId") || '';
      const accessToken: string | undefined = params.get("accessToken") || undefined;

      this.gameStateService.initialize(gameSessionId, playerSecret, playerSessionId, accessToken);
    });
  }

  shouldShowConfigComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.CONFIG;
  }

  shouldShowProctorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfProctor();
  }


  shouldShowBuzzerComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isSelfOnAnyTeam()
      && !this.gameStateService.isProctorless();
  }

  shouldShowSinglePlayerComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isSinglePlayer()
      && this.gameStateService.isSelfOnAnyTeam();
  }

  shouldShowAutoProctorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME
      && this.gameStateService.isAutoJudgedMultiplayer()
      && this.gameStateService.isSelfOnAnyTeam();
  }

  shouldShowSpectatorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfSpectator();
  }

  shouldShowMatchSummaryComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.COMPLETED;
  }

}
