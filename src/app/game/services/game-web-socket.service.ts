import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {Client, Message} from "@stomp/stompjs";

/**
 * GameWebSocketService
 *
 * This service is responsible for initializing and managing WebSocket connections
 * to handle real-time game-related events.
 */
@Injectable({
  providedIn: 'root',
})
export class GameWebSocketService {
  // Stomp.js client for handling STOMP over WebSocket
  private stompClient!: Client;

  // BehaviorSubject to hold the latest message received via WebSocket
  private messageSubject = new BehaviorSubject<Message | null>(null);

  // Observable exposed to subscribers interested in received messages
  public messageObservable$ = this.messageSubject.asObservable();

  constructor() {
  }

  /**
   * Initializes the WebSocket connection and sets up the event listeners.
   *
   * @param gameSessionId - The ID of the game session
   * @param playerSecret - The secret key for the player
   * @param playerSessionId - The ID of the player session
   */
  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string) {
    // Initialize the Stomp.js client with connection details
    this.stompClient = new Client({
      brokerURL: 'ws://localhost:8080/sockbowl-game',
      onConnect: () => {
        console.log("connected");

        // Subscribe to a specific queue for game and player session events
        this.stompClient.subscribe(`/queue/event/${gameSessionId}/${playerSessionId}`, message => {
          console.log(`Received: ${message.body}`);
          // Notify all subscribers of the new message
          this.messageSubject.next(message);
        });

        // Subscribe to a general queue for game session events
        this.stompClient.subscribe(`/queue/event/${gameSessionId}`, message => {
          console.log(`Received: ${message.body}`);
          // Notify all subscribers of the new message
          this.messageSubject.next(message);
        });

        // Publish an initial message to get the game configuration
        this.stompClient.publish({
          destination: '/app/game/config/get-game',
          headers: {
            gameSessionId: gameSessionId,
            playerSecret: playerSecret,
            playerSessionId: playerSessionId
          }
        });
      },
    });

    // Activate the client to initiate the connection
    this.stompClient.activate();
  }
}
