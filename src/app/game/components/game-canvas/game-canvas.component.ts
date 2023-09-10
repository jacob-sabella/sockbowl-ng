import {Component} from '@angular/core';
import {ActivatedRoute} from "@angular/router";
import {GameWebSocketService} from "../../services/game-web-socket.service";

@Component({
  selector: 'app-game-canvas',
  templateUrl: './game-canvas.component.html',
  styleUrls: ['./game-canvas.component.scss']
})
export class GameCanvasComponent {

  constructor(private route: ActivatedRoute, private gameWebSocketService: GameWebSocketService) {
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {

      let gameSessionId: string = params.get("gameSessionId") || '';
      let playerSecret: string = params.get("playerSecret") || '';
      let playerSessionId: string = params.get("playerSessionId") || '';

      console.log(gameSessionId, playerSecret, playerSessionId);

      this.gameWebSocketService.initialize(gameSessionId, playerSecret, playerSessionId);
    });
  }

}
