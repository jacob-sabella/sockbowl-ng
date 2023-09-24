import {GameWebSocketService} from "./game-web-socket.service";
import {BehaviorSubject, Observable} from "rxjs";
import {Injectable} from "@angular/core";

/**
 * GameMessageService
 *
 * This service is responsible for receiving messages from the GameWebSocketService,
 * translating them into models based on their `messageContentType`, and emitting these
 * models as observable events that other services can subscribe to.
 */
@Injectable({
  providedIn: 'root',
})
export class GameMessageService {
  // Holds BehaviorSubjects for each type of message content
  private gameEventSubjects: { [messageContentType: string]: BehaviorSubject<any> } = {};
  // Exposes Observables for each type of message content
  public gameEventObservables: { [messageContentType: string]: Observable<any> } = {};

  /**
   * Constructor
   *
   * @param gameWebSocketService - GameWebSocketService instance
   */
  constructor(private gameWebSocketService: GameWebSocketService) {
    // Subscribe to the WebSocket message observable
    this.gameWebSocketService.messageObservable$.subscribe({
      next: (message: any) => {
        const messageContentType = message.messageContentType;
        if (!this.gameEventSubjects[messageContentType]) {
          this.gameEventSubjects[messageContentType] = new BehaviorSubject<any>(null);
          this.gameEventObservables[messageContentType] = this.gameEventSubjects[messageContentType].asObservable();
        }
        const model = this.mapMessageToModel(message);
        this.gameEventSubjects[messageContentType].next(model);
      },
      error: (error: any) => {
        console.error('Error receiving message from websocket', error);
      }
    });
  }

  /**
   * Translates the received message into a model.
   *
   * @param message - The message received from WebSocket
   * @returns - The translated model
   */
  private mapMessageToModel(message: any): any {
    const messageContentType = message.messageContentType;
    let model: any;  // Replace with specific type mapping logic

    console.log("test");
    // Handle different types of messages
    switch (messageContentType) {
      case 'GameSessionUpdate':
        console.log("gamesklrjselk")
        model = {}
        break;
      // Add more cases here
      default:
        console.warn(`Unknown messageContentType: ${messageContentType}`);
        model = {};  // Assign a default, possibly empty, model
        break;
    }

    return model;
  }
}
