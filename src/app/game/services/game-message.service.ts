import {GameWebSocketService} from "./game-web-socket.service";
import {BehaviorSubject, Observable} from "rxjs";
import {Injectable} from "@angular/core";
import {SockbowlInMessage} from "../models/sockbowl/sockbowl-interfaces";

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
  // Key: messageContentType, Value: BehaviorSubject
  private gameEventSubjects: { [messageContentType: string]: BehaviorSubject<any> } = {};

  // Exposes Observables for each type of message content
  // Key: messageContentType, Value: Observable
  public gameEventObservables: { [messageContentType: string]: Observable<any> } = {};

  constructor(private gameWebSocketService: GameWebSocketService) {
    this.initializeSubjectsAndObservables()
  }

  private initializeSubjectsAndObservables() {
    // List of expected message types
    const expectedMessageTypes = [
      'GameSessionUpdate',
      'PlayerRosterUpdate',
      'GameStartedMessage',
      'MatchPacketUpdate',
      'ProcessError',
      'AnswerUpdate',
      'RoundUpdate',
      'PlayerBuzzed'
    ];

    // Initialize BehaviorSubjects and Observables for each expected message type
    for (const messageType of expectedMessageTypes) {
      this.gameEventSubjects[messageType] = new BehaviorSubject<any>(null);
      this.gameEventObservables[messageType] = this.gameEventSubjects[messageType].asObservable();
    }
  }

  /**
   * Constructor
   *
   * Initializes the GameMessageService instance and sets up subscriptions to the GameWebSocketService.
   *
   * @param gameSessionId
   * @param playerSecret
   * @param playerSessionId
   * @param accessToken Optional JWT access token for authenticated users
   */
  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string, accessToken?: string) {

    this.gameWebSocketService.initialize(gameSessionId, playerSecret, playerSessionId, accessToken)

    // Subscribe to the WebSocket message observable exposed by GameWebSocketService
    this.gameWebSocketService.messageObservable$.subscribe({
      // Whenever a new message is received
      next: (message: any) => {
        if(message != null){
          // Parse the incoming WebSocket message and create a SockbowlOutMessage object
          const sockbowlOutMessage = JSON.parse(message.body);

          // Publish the new message to the corresponding BehaviorSubject
          this.gameEventSubjects[sockbowlOutMessage.messageContentType].next(sockbowlOutMessage);
        }
      },
      // If an error occurs during the subscription
      error: (error: any) => {
        console.error('Error receiving message from websocket', error);
      }
    });
  }

  public sendMessage(path: string, value: SockbowlInMessage){
    this.gameWebSocketService.sendMessage(path, value)
  }
}
