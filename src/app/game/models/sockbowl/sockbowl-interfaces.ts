/* tslint:disable */
/* eslint-disable */

// Generated using typescript-generator version 3.2.1263 on 2023-10-14 13:31:21.

export class Bonus {
  id: number;
  subcategoryId: number;
  preamble: string;
  bonusParts: BonusPart[];
  subcategory: Subcategory;

  constructor(data: Bonus) {
    this.id = data.id;
    this.subcategoryId = data.subcategoryId;
    this.preamble = data.preamble;
    this.bonusParts = data.bonusParts;
    this.subcategory = data.subcategory;
  }
}

export class BonusPart {
  bonusId: number;
  question: string;
  answer: string;
  number: number;

  constructor(data: BonusPart) {
    this.bonusId = data.bonusId;
    this.question = data.question;
    this.answer = data.answer;
    this.number = data.number;
  }
}

export class Category {
  id: number;
  name: string;

  constructor(data: Category) {
    this.id = data.id;
    this.name = data.name;
  }
}

export class Difficulty {
  id: number;
  name: string;

  constructor(data: Difficulty) {
    this.id = data.id;
    this.name = data.name;
  }
}

export class Event {
  id: number;
  name: string;
  year: number;
  location: string;
  imported: boolean;
  eventPackets: EventPacket[];

  constructor(data: Event) {
    this.id = data.id;
    this.name = data.name;
    this.year = data.year;
    this.location = data.location;
    this.imported = data.imported;
    this.eventPackets = data.eventPackets;
  }
}

export class EventPacket {
  eventId: number;
  packetId: number;
  round: number;
  event: Event;
  packet: Packet;

  constructor(data: EventPacket) {
    this.eventId = data.eventId;
    this.packetId = data.packetId;
    this.round = data.round;
    this.event = data.event;
    this.packet = data.packet;
  }
}

export class Packet {
  id: number;
  name: string;
  tossups: PacketTossup[];
  bonuses: PacketBonus[];
  difficulty: Difficulty;

  constructor(data: Packet) {
    this.id = data.id;
    this.name = data.name;
    this.tossups = data.tossups;
    this.bonuses = data.bonuses;
    this.difficulty = data.difficulty;
  }
}

export class PacketBonus {
  packetId: number;
  bonusId: number;
  number: number;
  packet: Packet;
  bonus: Bonus;

  constructor(data: PacketBonus) {
    this.packetId = data.packetId;
    this.bonusId = data.bonusId;
    this.number = data.number;
    this.packet = data.packet;
    this.bonus = data.bonus;
  }
}

export class PacketTossup {
  packetId: number;
  tossupId: number;
  number: number;
  packet: Packet;
  tossup: Tossup;

  constructor(data: PacketTossup) {
    this.packetId = data.packetId;
    this.tossupId = data.tossupId;
    this.number = data.number;
    this.packet = data.packet;
    this.tossup = data.tossup;
  }
}

export class Subcategory {
  id: number;
  name: string;
  categoryId: number;
  category: Category;

  constructor(data: Subcategory) {
    this.id = data.id;
    this.name = data.name;
    this.categoryId = data.categoryId;
    this.category = data.category;
  }
}

export class Tossup {
  id: number;
  question: string;
  subcategoryId: number;
  answer: string;
  subcategory: Subcategory;

  constructor(data: Tossup) {
    this.id = data.id;
    this.question = data.question;
    this.subcategoryId = data.subcategoryId;
    this.answer = data.answer;
    this.subcategory = data.subcategory;
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

  constructor(data: JoinGameResponse) {
    this.joinStatus = data.joinStatus;
    this.gameSessionId = data.gameSessionId;
    this.playerSecret = data.playerSecret;
    this.playerSessionId = data.playerSessionId;
  }
}

export class MessageQueues {

  constructor(data: MessageQueues) {
  }
}

export class SockbowlInMessage {
  constructor(data: SockbowlInMessage) {

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
  packetId: number;

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

  constructor(data: TimeoutRound) {
    super(data);
  }
}

export class AdvanceRound extends SockbowlInMessage {

  constructor(data: AdvanceRound) {
    super(data);
  }
}

export class StartMatch extends SockbowlInMessage {

  constructor(data: StartMatch) {
    super(data);
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
  packetId: number;
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

export class GameSettings {
  proctorType: ProctorType;
  gameMode: GameMode;

  constructor(data: GameSettings) {
    this.proctorType = data.proctorType;
    this.gameMode = data.gameMode;
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
  proctorFinishedReading: boolean;

  constructor(data: Round) {
    this.roundState = data.roundState;
    this.roundNumber = data.roundNumber;
    this.currentBuzz = data.currentBuzz;
    this.buzzList = data.buzzList;
    this.question = data.question;
    this.answer = data.answer;
    this.proctorFinishedReading = data.proctorFinishedReading;
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
  COMPLETED = "COMPLETED",
}
