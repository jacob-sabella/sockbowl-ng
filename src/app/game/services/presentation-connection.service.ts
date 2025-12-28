import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CastGameState, PresentationConnectionState } from '../models/cast-interfaces';

/**
 * Type declarations for Chrome Presentation API
 * These are browser APIs and may not be available in all environments.
 */
declare global {
  interface Window {
    PresentationRequest: any;
  }
}

/**
 * PresentationConnectionService
 *
 * Manages the Chrome Presentation API connection lifecycle for casting game state
 * to Chromecast devices, smart TVs, and other presentation displays.
 *
 * This service handles:
 * - Feature detection for Presentation API availability
 * - Initiating and managing presentation connections
 * - Sending serialized game state to the receiver
 * - Connection state management and error handling
 */
@Injectable({
  providedIn: 'root'
})
export class PresentationConnectionService {
  /** Observable for whether the Presentation API is available in this browser */
  public readonly isAvailable$: Observable<boolean>;
  private readonly isAvailableSubject: BehaviorSubject<boolean>;

  /** Observable for the current connection state */
  public readonly connectionState$: Observable<PresentationConnectionState>;
  private readonly connectionStateSubject: BehaviorSubject<PresentationConnectionState>;

  /** The active PresentationRequest object (null if API unavailable) */
  private presentationRequest: any | null = null;

  /** The active PresentationConnection object (null if not connected) */
  private presentationConnection: any | null = null;

  /** URL of the receiver page (served from same origin as main app) */
  private readonly receiverUrl = '/cast-receiver.html';

  constructor(private snackBar: MatSnackBar) {
    // Check if Presentation API is available
    const available = 'PresentationRequest' in window;
    this.isAvailableSubject = new BehaviorSubject<boolean>(available);
    this.isAvailable$ = this.isAvailableSubject.asObservable();

    // Initialize connection state
    this.connectionStateSubject = new BehaviorSubject<PresentationConnectionState>(
      PresentationConnectionState.DISCONNECTED
    );
    this.connectionState$ = this.connectionStateSubject.asObservable();

    // Create PresentationRequest if API is available
    if (available) {
      try {
        this.presentationRequest = new (window as any).PresentationRequest([this.receiverUrl]);
        this.setupPresentationRequestHandlers();
      } catch (error) {
        console.error('Failed to create PresentationRequest:', error);
        this.isAvailableSubject.next(false);
      }
    }
  }

  /**
   * Initiates a presentation connection.
   * Opens the browser's device picker UI for the user to select a cast device.
   */
  public async startPresentation(): Promise<void> {
    if (!this.presentationRequest) {
      this.showError('Casting is not available in this browser. Please use Chrome.');
      return;
    }

    if (this.connectionStateSubject.value === PresentationConnectionState.CONNECTED) {
      console.warn('Presentation already connected');
      return;
    }

    try {
      this.connectionStateSubject.next(PresentationConnectionState.CONNECTING);

      // Request presentation (opens device picker)
      this.presentationConnection = await this.presentationRequest.start();

      // Setup connection event handlers
      this.setupConnectionHandlers(this.presentationConnection);

      // Update state to connected
      this.connectionStateSubject.next(PresentationConnectionState.CONNECTED);

      this.showSuccess('Connected to cast device');
    } catch (error: any) {
      // User cancelled device picker or connection failed
      console.error('Failed to start presentation:', error);

      if (error.name === 'AbortError') {
        // User cancelled - not an error, just go back to disconnected
        this.connectionStateSubject.next(PresentationConnectionState.DISCONNECTED);
      } else if (error.name === 'NotAllowedError') {
        this.showError('Casting permission denied');
        this.connectionStateSubject.next(PresentationConnectionState.DISCONNECTED);
      } else {
        this.showError('Failed to connect to cast device: ' + error.message);
        this.connectionStateSubject.next(PresentationConnectionState.TERMINATED);
      }
    }
  }

  /**
   * Stops the active presentation connection.
   * Terminates the connection to the cast device.
   */
  public stopPresentation(): void {
    if (this.presentationConnection) {
      try {
        this.presentationConnection.terminate();
      } catch (error) {
        console.error('Error terminating presentation:', error);
      }
    }

    this.cleanup();
    this.connectionStateSubject.next(PresentationConnectionState.DISCONNECTED);
    this.showSuccess('Disconnected from cast device');
  }

  /**
   * Sends the current game state to the connected cast receiver.
   * @param state The game state to send
   */
  public sendGameState(state: CastGameState): void {
    if (!this.presentationConnection ||
        this.connectionStateSubject.value !== PresentationConnectionState.CONNECTED) {
      console.warn('Cannot send state: no active presentation connection');
      return;
    }

    try {
      const message = JSON.stringify(state);
      this.presentationConnection.send(message);
    } catch (error) {
      console.error('Failed to send game state to receiver:', error);
      this.showError('Failed to send update to cast device');
    }
  }

  /**
   * Sets up event handlers for the PresentationRequest.
   * These handlers are for connection availability monitoring.
   */
  private setupPresentationRequestHandlers(): void {
    if (!this.presentationRequest) return;

    // Monitor for connection availability changes
    this.presentationRequest.addEventListener('connectionavailable', (event: any) => {
      console.log('Presentation connection available');
    });
  }

  /**
   * Sets up event handlers for an active PresentationConnection.
   * @param connection The connection to monitor
   */
  private setupConnectionHandlers(connection: any): void {
    // Connection closed event (user closed receiver or network issue)
    connection.addEventListener('close', () => {
      console.log('Presentation connection closed');
      this.cleanup();
      this.connectionStateSubject.next(PresentationConnectionState.DISCONNECTED);
      this.showSuccess('Cast session ended');
    });

    // Connection terminated event (programmatic termination)
    connection.addEventListener('terminate', () => {
      console.log('Presentation connection terminated');
      this.cleanup();
      this.connectionStateSubject.next(PresentationConnectionState.TERMINATED);
    });

    // Message received from receiver (for future bidirectional communication)
    connection.addEventListener('message', (event: any) => {
      console.log('Message from receiver:', event.data);
      // Future: Handle receiver feedback (e.g., ready state, error reports)
    });
  }

  /**
   * Cleans up the current connection and releases resources.
   */
  private cleanup(): void {
    this.presentationConnection = null;
  }

  /**
   * Shows a success message to the user.
   */
  private showSuccess(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom'
    });
  }

  /**
   * Shows an error message to the user.
   */
  private showError(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: 5000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['error-snackbar']
    });
  }
}
