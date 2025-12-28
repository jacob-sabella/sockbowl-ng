/**
 * Cast Interfaces
 *
 * TypeScript type definitions for the Chrome Presentation API casting feature.
 * These interfaces define the message protocol between the main app and the cast receiver.
 */

import { RoundState } from './sockbowl/sockbowl-interfaces';

/**
 * State object sent to the cast receiver containing all information
 * needed to display the current game state on a TV screen.
 */
export interface CastGameState {
  /** Message type identifier for protocol discrimination */
  messageType: 'GAME_STATE_UPDATE';

  /** Timestamp when this state was sent (for handling out-of-order messages) */
  timestamp: number;

  /** Whether the game is in config stage (pre-match) or active match */
  isConfigStage: boolean;

  /* ===== Config Stage Fields (when isConfigStage = true) ===== */

  /** Game session join code for players to join */
  joinCode?: string;

  /** Team rosters with player names */
  teamRosters?: CastTeamRoster[];

  /** Name of the selected packet (if any) */
  packetName?: string;

  /** Game mode setting */
  gameMode?: string;

  /** Proctor's display name */
  proctorName?: string;

  /* ===== Active Match Fields (when isConfigStage = false) ===== */

  /** Current round number (e.g., "Round 5") */
  roundNumber: number;

  /** Question category (e.g., "History") */
  category: string;

  /** Question subcategory (e.g., "American History") */
  subcategory: string;

  /** Current round state (used to determine UI state on receiver) */
  roundState: RoundState;

  /** Whether the question text should be visible on the cast screen */
  questionVisible: boolean;

  /** The tossup question text (HTML string) */
  questionText: string;

  /** Whether the answer text should be visible on the cast screen */
  answerVisible: boolean;

  /** The tossup answer text (HTML string) */
  answerText: string;

  /** Information about the current buzz (null if no active buzz) */
  currentBuzz: CastBuzzInfo | null;

  /** Array of team scores for scoreboard display */
  teamScores: CastTeamScore[];
}

/**
 * Information about a player's buzz in the current round.
 */
export interface CastBuzzInfo {
  /** Player's display name */
  playerName: string;

  /** Team's display name */
  teamName: string;

  /** Team ID (for potential styling/theming) */
  teamId: string;

  /**
   * Whether the buzz was correct
   * - true: Correct answer
   * - false: Incorrect answer
   * - null: Not yet judged by proctor
   */
  correct: boolean | null;
}

/**
 * Team score information for scoreboard display.
 */
export interface CastTeamScore {
  /** Unique team identifier */
  teamId: string;

  /** Team's display name */
  teamName: string;

  /**
   * Total team score (tossup points + bonus points)
   * - Tossup: 10 points per correct buzz
   * - Bonus: 10 points per correct bonus part (max 30 per bonus)
   */
  score: number;
}

/**
 * Team roster information for config stage display.
 */
export interface CastTeamRoster {
  /** Unique team identifier */
  teamId: string;

  /** Team's display name */
  teamName: string;

  /** Array of player names on this team */
  playerNames: string[];
}

/**
 * Connection state for the Chrome Presentation API connection.
 * Used to manage UI state for the cast button.
 */
export enum PresentationConnectionState {
  /** No active connection, ready to initiate casting */
  DISCONNECTED = 'disconnected',

  /** Connection request in progress, waiting for user to select device */
  CONNECTING = 'connecting',

  /** Active connection established, sending state updates */
  CONNECTED = 'connected',

  /** Connection was terminated (by user or error), cannot reconnect */
  TERMINATED = 'terminated'
}
