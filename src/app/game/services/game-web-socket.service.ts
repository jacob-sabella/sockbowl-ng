import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {Client, Message, Stomp} from "@stomp/stompjs";

@Injectable({
  providedIn: 'root',
})
export class GameWebSocketService {
  private stompClient!: Client;

  constructor() {
  }

  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string) {
    this.stompClient = new Client({
      brokerURL: 'ws://localhost:8080/sockbowl-game',
      onConnect: () => {
        console.log("connected")

        this.stompClient.subscribe("/queue/event/" + gameSessionId, message =>
          console.log(`Received: ${message.body}`)
        );

        this.stompClient.publish({
          destination: '/app/game/config/get-game', headers: {
            gameSessionId: gameSessionId,
            playerSecret: playerSecret,
            playerSessionId: playerSessionId
          }
        });
      },
    });

    this.stompClient.activate();
  }


}
