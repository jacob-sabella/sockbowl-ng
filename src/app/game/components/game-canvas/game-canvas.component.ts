import {Component} from '@angular/core';
import {ActivatedRoute} from "@angular/router";
import {GameStateService} from "../../services/game-state.service";
import {Observable} from "rxjs";
import {GameSession, MatchState} from "../../models/sockbowl/sockbowl-interfaces";

@Component({
  selector: 'app-game-canvas',
  templateUrl: './game-canvas.component.html',
  styleUrls: ['./game-canvas.component.scss']
})
export class GameCanvasComponent {

  gameSession$: Observable<GameSession>;

  constructor(private route: ActivatedRoute, private gameStateService: GameStateService) {
    this.gameSession$ = this.gameStateService.gameSession$;
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {

      let gameSessionId: string = params.get("gameSessionId") || '';
      let playerSecret: string = params.get("playerSecret") || '';
      let playerSessionId: string = params.get("playerSessionId") || '';

      console.log(gameSessionId, playerSecret, playerSessionId);

      this.gameStateService.initialize(gameSessionId, playerSecret, playerSessionId);
    });
  }

  shouldShowConfigComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.CONFIG;
  }

  shouldShowProctorComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfProctor();
  }


  shouldShowBuzzerComponent(): boolean {
    return this.gameStateService.getMatchState() == MatchState.IN_GAME && this.gameStateService.isSelfOnAnyTeam();
  }

}
