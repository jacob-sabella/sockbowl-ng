import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {Client, Message} from "@stomp/stompjs";
import {SockbowlInMessage} from "../models/sockbowl/sockbowl-interfaces";
import {environment} from "../../../environments/environment";
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

  private gameSessionId!: string;
  private playerSecret!: string;
  private playerSessionId!: string;
  private accessToken?: string; // JWT token for authenticated users

  constructor() {
  }

  /**
   * Initializes the WebSocket connection and sets up the event listeners.
   *
   * Supports two authentication modes:
   * - Guest mode: uses playerSecret header
   * - Authenticated mode: uses Authorization Bearer token
   *
   * @param gameSessionId - The ID of the game session
   * @param playerSecret - The secret key for the player (guest mode)
   * @param playerSessionId - The ID of the player session
   * @param accessToken - Optional JWT access token for authenticated users
   */
  public initialize(gameSessionId: string, playerSecret: string, playerSessionId: string, accessToken?: string) {

    this.gameSessionId = gameSessionId;
    this.playerSecret = playerSecret;
    this.playerSessionId = playerSessionId;
    this.accessToken = accessToken;

    // Initialize the Stomp.js client with connection details
    this.stompClient = new Client({
      brokerURL: environment.wsUrl,
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
        const headers: any = {
          gameSessionId: gameSessionId,
          playerSessionId: playerSessionId
        };

        // Add authentication headers based on mode
        if (this.accessToken) {
          // Authenticated mode: use JWT Bearer token
          headers['Authorization'] = `Bearer ${this.accessToken}`;
        } else {
          // Guest mode: use playerSecret
          headers['playerSecret'] = playerSecret;
        }

        this.stompClient.publish({
          destination: '/app/game/config/get-game',
          headers: headers
        });
      },
    });

    // Activate the client to initiate the connection
    this.stompClient.activate();
  }

  public sendMessage(path: string, value: SockbowlInMessage){
    console.log(JSON.stringify(value))

    const headers: any = {
      gameSessionId: this.gameSessionId,
      playerSessionId: this.playerSessionId
    };

    // Add authentication headers based on mode
    if (this.accessToken) {
      // Authenticated mode: use JWT Bearer token
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    } else {
      // Guest mode: use playerSecret
      headers['playerSecret'] = this.playerSecret;
    }

    this.stompClient.publish({
      destination: path,
      body: JSON.stringify(value),
      headers: headers
    })
  }
}
