/* tslint:disable */
/* eslint-disable */

// Gameplay / message types for the live game (sourced from the game backend).
//
// The PACKET domain types (Packet, Bonus, Tossup, BonusPart, Difficulty,
// Subcategory, Category, Event and the Contains*/HasBonusPart/UsesPacketAtRound
// relationship types) are the single source of truth in sockbowl-questions and
// are generated from its GraphQL schema into ./packet-types.generated.ts.
// They are imported (and re-exported) here for the gameplay types that embed
// them; do NOT re-declare them by hand.
import { Bonus, Packet } from './packet-types.generated';

export { Bonus, Packet };

export class BonusPartAnswer {
  partIndex: number;
  correct: boolean;

  constructor(data: BonusPartAnswer) {
    this.partIndex = data.partIndex;
    this.correct = data.correct;
  }
}

export class CreateGameRequest {
  gameSettings: GameSettings;

  constructor(data: CreateGameRequest) {
    this.gameSettings = data.gameSettings;
  }
}

export class GameSessionInjection {
  playerIdentifiers: PlayerIdentifiers;
  gameSessionId: string;
  gameSession: GameSession;

  constructor(data: GameSessionInjection) {
    this.playerIdentifiers = data.playerIdentifiers;
    this.gameSessionId = data.gameSessionId;
    this.gameSession = data.gameSession;
  }
}

export class JoinGameRequest {
  playerSessionId: string;
  joinCode: string;
  name: string;

  constructor(data: JoinGameRequest) {
    this.playerSessionId = data.playerSessionId;
    this.joinCode = data.joinCode;
    this.name = data.name;
  }
}

export class PlayerIdentifiers {
  simpSessionId: string;
  playerSecret: string;

  constructor(data: PlayerIdentifiers) {
    this.simpSessionId = data.simpSessionId;
    this.playerSecret = data.playerSecret;
  }
}

export class GameSessionIdentifiers {
  id: string;
  joinCode: string;

  constructor(data: GameSessionIdentifiers) {
    this.id = data.id;
    this.joinCode = data.joinCode;
  }
}

export class JoinGameResponse {
  joinStatus: JoinStatus;
  gameSessionId: string;
  playerSecret: string;
  playerSessionId: string;
  userId?: string;

  constructor(data: JoinGameResponse) {
    this.joinStatus = data.joinStatus;
    this.gameSessionId = data.gameSessionId;
    this.playerSecret = data.playerSecret;
    this.playerSessionId = data.playerSessionId;
    this.userId = data.userId;
  }
}

export class MessageQueues {

  constructor(data: MessageQueues) {
  }
}

export class SockbowlInMessage {
  constructor(data?: Partial<SockbowlInMessage>) {

  }
}

export class TestSockbowlInMessage extends SockbowlInMessage {
  testString: string;

  constructor(data: TestSockbowlInMessage) {
    super(data);
    this.testString = data.testString;
  }
}

export class GetGameState extends SockbowlInMessage {

  constructor(data: GetGameState) {
    super(data);
  }
}

export class SetMatchPacket extends SockbowlInMessage {
  packetId: String;

  constructor(data: SetMatchPacket) {
    super(data);
    this.packetId = data.packetId;
  }
}

export class SetProctor extends SockbowlInMessage {
  targetPlayer: string;

  constructor(data: SetProctor) {
    super(data);
    this.targetPlayer = data.targetPlayer;
  }
}

export class UpdatePlayerTeam extends SockbowlInMessage {
  targetPlayer: string;
  targetTeam: string;

  constructor(data: UpdatePlayerTeam) {
    super(data);
    this.targetPlayer = data.targetPlayer;
    this.targetTeam = data.targetTeam;
  }
}

export class AnswerOutcome extends SockbowlInMessage {
  correct: boolean;

  constructor(data: AnswerOutcome) {
    super(data);
    this.correct = data.correct;
  }
}

export class SubmitAnswer extends SockbowlInMessage {
  answerText: string;

  constructor(data: SubmitAnswer) {
    super(data);
    this.answerText = data.answerText;
  }
}

export class FinishedReading extends SockbowlInMessage {

  constructor(data: FinishedReading) {
    super(data);
  }
}

export class PlayerIncomingBuzz extends SockbowlInMessage {

  constructor(data: PlayerIncomingBuzz) {
    super(data);
  }
}

export class TimeoutRound extends SockbowlInMessage {
  autoTimeout?: boolean;

  constructor(data?: Partial<TimeoutRound>) {
    super(data);
    this.autoTimeout = data?.autoTimeout ?? false;
  }
}

export class AdvanceRound extends SockbowlInMessage {

  constructor(data: AdvanceRound) {
    super(data);
  }
}

export class FinishedReadingBonusPreamble extends SockbowlInMessage {

  constructor(data: FinishedReadingBonusPreamble) {
    super(data);
  }
}

export class FinishedReadingBonusPart extends SockbowlInMessage {

  constructor(data: FinishedReadingBonusPart) {
    super(data);
  }
}

export class TimeoutBonusPart extends SockbowlInMessage {
  autoTimeout?: boolean;

  constructor(data?: Partial<TimeoutBonusPart>) {
    super(data);
    this.autoTimeout = data?.autoTimeout ?? false;
  }
}

export class StartMatch extends SockbowlInMessage {

  constructor(data: StartMatch) {
    super(data);
  }
}

export class EndMatch extends SockbowlInMessage {

  constructor(data: EndMatch) {
    super(data);
  }
}

export class BonusPartOutcome extends SockbowlInMessage {
  partIndex: number;
  correct: boolean;

  constructor(data: BonusPartOutcome) {
    super(data);
    this.partIndex = data.partIndex;
    this.correct = data.correct;
  }
}

export class UpdateGameSettings extends SockbowlInMessage {
  gameSettings: GameSettings;

  constructor(data: UpdateGameSettings) {
    super(data);
    this.gameSettings = data.gameSettings;
  }
}

export class SockbowlOutMessage {
  messageContentType: string;
  messageType: MessageTypes;

  constructor(data: SockbowlOutMessage) {
    this.messageContentType = data.messageContentType;
    this.messageType = data.messageType;
  }
}

export class MatchPacketUpdate extends SockbowlOutMessage {
  packetId: string;
  packetName: string;

  constructor(data: MatchPacketUpdate) {
    super(data);
    this.packetId = data.packetId;
    this.packetName = data.packetName;
  }
}

export class PlayerRosterUpdate extends SockbowlOutMessage {
  playerList: Player[];
  teamList: Team[];

  constructor(data: PlayerRosterUpdate) {
    super(data);
    this.playerList = data.playerList;
    this.teamList = data.teamList;
  }
}

export class ProcessError extends SockbowlOutMessage {
  error: string;

  constructor(data: ProcessError) {
    super(data);
    this.error = data.error;
  }
}

export class AnswerUpdate extends SockbowlOutMessage {
  currentRound: Round;
  correct: boolean;
  playerId: string;
  previousRounds: Round[];

  constructor(data: AnswerUpdate) {
    super(data);
    this.currentRound = data.currentRound;
    this.correct = data.correct;
    this.playerId = data.playerId;
    this.previousRounds = data.previousRounds;
  }
}

export class PlayerBuzzed extends SockbowlOutMessage {
  playerId: string;
  teamId: string;
  round: Round;

  constructor(data: PlayerBuzzed) {
    super(data);
    this.playerId = data.playerId;
    this.teamId = data.teamId;
    this.round = data.round;
  }
}

export class RoundUpdate extends SockbowlOutMessage {
  round: Round;
  previousRounds: Round[];

  constructor(data: RoundUpdate) {
    super(data);
    this.round = data.round;
    this.previousRounds = data.previousRounds;
  }
}

export class BonusUpdate extends SockbowlOutMessage {
  currentRound: Round;
  previousRounds: Round[];
  partIndex: number;
  correct: boolean;

  constructor(data: BonusUpdate) {
    super(data);
    this.currentRound = data.currentRound;
    this.previousRounds = data.previousRounds;
    this.partIndex = data.partIndex;
    this.correct = data.correct;
  }
}

export class GameSessionUpdate extends SockbowlOutMessage {
  gameSession: GameSession;

  constructor(data: GameSessionUpdate) {
    super(data);
    this.gameSession = data.gameSession;
  }
}

export class GameStartedMessage extends SockbowlOutMessage {

  constructor(data: GameStartedMessage) {
    super(data);
  }
}

export class TimerUpdate extends SockbowlOutMessage {
  timerType: string;
  remainingSeconds: number;

  constructor(data: TimerUpdate) {
    super(data);
    this.timerType = data.timerType;
    this.remainingSeconds = data.remainingSeconds;
  }
}

export class Buzz {
  playerId: string;
  teamId: string;
  correct: boolean;

  constructor(data: Buzz) {
    this.playerId = data.playerId;
    this.teamId = data.teamId;
    this.correct = data.correct;
  }
}

export class GameSession {
  id: string;
  joinCode: string;
  gameSettings: GameSettings;
  playerList: Player[];
  teamList: Team[];
  currentMatch: Match;
  currentRound: Round;
  proctor: Player;

  constructor(data: GameSession) {
    this.id = data.id;
    this.joinCode = data.joinCode;
    this.gameSettings = data.gameSettings;
    this.playerList = data.playerList;
    this.teamList = data.teamList;
    this.currentMatch = data.currentMatch;
    this.currentRound = data.currentRound;
    this.proctor = data.proctor;
  }
}

export class TimerSettings {
  tossupTimerSeconds: number;
  bonusTimerSeconds: number;
  autoTimerEnabled: boolean;

  constructor(data?: Partial<TimerSettings>) {
    this.tossupTimerSeconds = data?.tossupTimerSeconds ?? 5;
    this.bonusTimerSeconds = data?.bonusTimerSeconds ?? 5;
    this.autoTimerEnabled = data?.autoTimerEnabled ?? true;
  }
}

export class GameSettings {
  proctorType: ProctorType;
  gameMode: GameMode;
  bonusesEnabled: boolean;
  timerSettings: TimerSettings;

  constructor(data: GameSettings) {
    this.proctorType = data.proctorType;
    this.gameMode = data.gameMode;
    this.bonusesEnabled = data.bonusesEnabled;
    this.timerSettings = data.timerSettings || new TimerSettings();
  }
}

export class Match {
  matchState: MatchState;
  packet: Packet;
  previousRounds: Round[];
  currentRound: Round;

  constructor(data: Match) {
    this.matchState = data.matchState;
    this.packet = data.packet;
    this.previousRounds = data.previousRounds;
    this.currentRound = data.currentRound;
  }
}

export class Player {
  playerMode: PlayerMode;
  playerStatus: PlayerStatus;
  playerId: string;
  playerSecret: string;
  name: string;
  gameOwner: boolean;

  constructor(data: Player) {
    this.playerMode = data.playerMode;
    this.playerStatus = data.playerStatus;
    this.playerId = data.playerId;
    this.playerSecret = data.playerSecret;
    this.name = data.name;
    this.gameOwner = data.gameOwner;
  }
}

export class PlayerSettings {
  maxPlayersPerTeam: number;
  numTeams: number;
  maxPlayers: number;

  constructor(data: PlayerSettings) {
    this.maxPlayersPerTeam = data.maxPlayersPerTeam;
    this.numTeams = data.numTeams;
    this.maxPlayers = data.maxPlayers;
  }
}

export class PlayerSettingsByGameMode {

  constructor(data: PlayerSettingsByGameMode) {
  }
}

export class Round {
  roundState: RoundState;
  roundNumber: number;
  currentBuzz: Buzz;
  buzzList: Buzz[];
  question: string;
  answer: string;
  category: string;
  subcategory: string;
  proctorFinishedReading: boolean;
  // Bonus-related fields
  associatedBonus: Bonus;
  currentBonus: Bonus;
  bonusPartAnswers: BonusPartAnswer[];
  currentBonusPartIndex: number;
  bonusEligibleTeamId: string;
  proctorFinishedReadingBonusPreamble: boolean;
  proctorFinishedReadingCurrentPart: boolean;
  // Timer fields
  remainingTossupTimerSeconds?: number;
  remainingBonusTimerSeconds?: number;
  timerStartedAtMillis?: number;

  constructor(data: Round) {
    this.roundState = data.roundState;
    this.roundNumber = data.roundNumber;
    this.currentBuzz = data.currentBuzz;
    this.buzzList = data.buzzList;
    this.question = data.question;
    this.answer = data.answer;
    this.proctorFinishedReading = data.proctorFinishedReading;
    this.category = data.category;
    this.subcategory = data.category;
    this.associatedBonus = data.associatedBonus;
    this.currentBonus = data.currentBonus;
    this.bonusPartAnswers = data.bonusPartAnswers;
    this.currentBonusPartIndex = data.currentBonusPartIndex;
    this.bonusEligibleTeamId = data.bonusEligibleTeamId;
    this.proctorFinishedReadingBonusPreamble = data.proctorFinishedReadingBonusPreamble;
    this.proctorFinishedReadingCurrentPart = data.proctorFinishedReadingCurrentPart;
    this.remainingTossupTimerSeconds = data.remainingTossupTimerSeconds;
    this.remainingBonusTimerSeconds = data.remainingBonusTimerSeconds;
    this.timerStartedAtMillis = data.timerStartedAtMillis;
  }
}

export class Team {
  teamId: string;
  teamName: string;
  teamPlayers: Player[];

  constructor(data: Team) {
    this.teamId = data.teamId;
    this.teamName = data.teamName;
    this.teamPlayers = data.teamPlayers;
  }
}

export enum MessageTypes {
  CONFIG = "CONFIG",
  GENERIC = "GENERIC",
  PROGRESSION = "PROGRESSION",
  MULTI = "MULTI",
  GAME = "GAME",
  ERROR = "ERROR",
}

export enum GameMode {
  QUIZ_BOWL_CLASSIC = "QUIZ_BOWL_CLASSIC",
  SINGLE_PLAYER = "SINGLE_PLAYER",
}

export enum JoinStatus {
  SUCCESS = "SUCCESS",
  GAME_DOES_NOT_EXIST = "GAME_DOES_NOT_EXIST",
  SESSION_FULL = "SESSION_FULL",
  MODE_NOT_ALLOWED = "MODE_NOT_ALLOWED",
  MODE_FULL = "MODE_FULL",
}

export enum MatchState {
  CONFIG = "CONFIG",
  IN_GAME = "IN_GAME",
  COMPLETED = "COMPLETED"
}

export enum PlayerMode {
  BUZZER = "BUZZER",
  PROCTOR = "PROCTOR",
  SPECTATOR = "SPECTATOR",
  DISPLAY = "DISPLAY",
}

export enum PlayerStatus {
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
}

export enum ProctorType {
  IN_PERSON_PROCTOR = "IN_PERSON_PROCTOR",
  ONLINE_PROCTOR = "ONLINE_PROCTOR",
  NO_PROCTOR = "NO_PROCTOR",
}

export enum RoundState {
  PROCTOR_READING = "PROCTOR_READING",
  AWAITING_BUZZ = "AWAITING_BUZZ",
  AWAITING_ANSWER = "AWAITING_ANSWER",
  BONUS_READING_PREAMBLE = "BONUS_READING_PREAMBLE",
  BONUS_READING_PART = "BONUS_READING_PART",
  BONUS_AWAITING_ANSWER = "BONUS_AWAITING_ANSWER",
  BONUS_COMPLETED = "BONUS_COMPLETED",
  COMPLETED = "COMPLETED",
}
