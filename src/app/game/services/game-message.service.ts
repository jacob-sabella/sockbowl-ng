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
      'PlayerBuzzed',
      'BonusUpdate',
      'TimerUpdate'
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
          // Parse the incoming WebSocket message and dispatch it (may be a
          // SockbowlMultiOutMessage batch, e.g. the initial game state on join).
          this.dispatchMessage(JSON.parse(message.body));
        }
      },
      // If an error occurs during the subscription
      error: (error: any) => {
        console.error('Error receiving message from websocket', error);
      }
    });
  }

  /**
   * Routes a single incoming message to its typed BehaviorSubject. Unwraps
   * SockbowlMultiOutMessage batches (the backend sends the initial game state
   * this way on join). Unknown message types are logged and skipped instead of
   * throwing (which previously left the game canvas blank).
   */
  private dispatchMessage(message: any): void {
    if (message == null) {
      return;
    }

    // Batch wrapper: recurse into each inner message.
    if (message.messageContentType === 'SockbowlMultiOutMessage' && Array.isArray(message.sockbowlOutMessages)) {
      for (const inner of message.sockbowlOutMessages) {
        this.dispatchMessage(inner);
      }
      return;
    }

    // Transform bonus data structure if present
    this.transformBonusData(message);

    const subject = this.gameEventSubjects[message.messageContentType];
    if (subject) {
      subject.next(message);
    } else {
      console.warn('[GameMessageService] Unhandled message type:', message.messageContentType);
    }
  }

  /**
   * Transforms nested bonus data structure from backend to flat structure expected by frontend.
   * Modifies the message object in place.
   */
  private transformBonusData(message: any): void {
    // Transform bonuses in currentRound if present
    if (message.currentRound) {
      if (message.currentRound.currentBonus) {
        message.currentRound.currentBonus = this.flattenBonus(message.currentRound.currentBonus);
      }
      if (message.currentRound.associatedBonus) {
        message.currentRound.associatedBonus = this.flattenBonus(message.currentRound.associatedBonus);
      }
    }

    // Transform bonuses in previousRounds if present
    if (message.previousRounds && Array.isArray(message.previousRounds)) {
      message.previousRounds.forEach((round: any) => {
        if (round.currentBonus) {
          round.currentBonus = this.flattenBonus(round.currentBonus);
        }
        if (round.associatedBonus) {
          round.associatedBonus = this.flattenBonus(round.associatedBonus);
        }
      });
    }
  }

  /**
   * Flattens a single bonus object by extracting bonusPart from HasBonusPart wrappers
   */
  private flattenBonus(bonus: any): any {
    if (!bonus || !bonus.bonusParts) {
      return bonus;
    }

    console.log('[GameMessageService] Flattening bonus, original bonusParts:', bonus.bonusParts);

    // First, extract and pair each bonusPart with its order
    const partsWithOrder = bonus.bonusParts.map((hasBonusPart: any) => ({
      order: hasBonusPart.order || 0,
      part: hasBonusPart.bonusPart || hasBonusPart
    }));

    // Sort by order
    partsWithOrder.sort((a: any, b: any) => a.order - b.order);

    // Extract just the parts
    const flattenedParts = partsWithOrder.map((item: any) => item.part);

    console.log('[GameMessageService] Flattened bonusParts:', flattenedParts);
    console.log('[GameMessageService] First part detail:', flattenedParts[0]);

    const flattened = {
      ...bonus,
      bonusParts: flattenedParts
    };

    return flattened;
  }

  public sendMessage(path: string, value: SockbowlInMessage){
    this.gameWebSocketService.sendMessage(path, value)
  }
}
