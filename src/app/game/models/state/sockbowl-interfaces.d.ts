/* tslint:disable */
/* eslint-disable */
// Generated using typescript-generator version 3.2.1263 on 2023-09-30 16:51:16.

export interface Bonus {
  id: number;
  subcategoryId: number;
  preamble: string;
  bonusParts: BonusPart[];
  subcategory: Subcategory;
}

export interface BonusPart {
  bonusId: number;
  question: string;
  answer: string;
  number: number;
}

export interface Category {
  id: number;
  name: string;
}

export interface Difficulty {
  id: number;
  name: string;
}

export interface Event {
  id: number;
  name: string;
  year: number;
  location: string;
  imported: boolean;
  eventPackets: EventPacket[];
}

export interface EventPacket {
  eventId: number;
  packetId: number;
  round: number;
  event: Event;
  packet: Packet;
}

export interface Packet {
  id: number;
  name: string;
  tossups: PacketTossup[];
  bonuses: PacketBonus[];
  difficulty: Difficulty;
}

export interface PacketBonus {
  packetId: number;
  bonusId: number;
  number: number;
  packet: Packet;
  bonus: Bonus;
}

export interface PacketTossup {
  packetId: number;
  tossupId: number;
  number: number;
  packet: Packet;
  tossup: Tossup;
}

export interface Subcategory {
  id: number;
  name: string;
  categoryId: number;
  category: Category;
}

export interface Tossup {
  id: number;
  question: string;
  subcategoryId: number;
  answer: string;
  subcategory: Subcategory;
}

export interface Buzz {
  playerId: string;
  teamId: string;
  correct: boolean;
}

export interface GameSession {
  id: string;
  joinCode: string;
  gameSettings: GameSettings;
  playerList: Player[];
  teamList: Team[];
  currentMatch: Match;
  currentRound: Round;
  proctor: Player;
}

export interface GameSettings {
  proctorType: ProctorType;
  gameMode: GameMode;
}

export interface Match {
  matchState: MatchState;
  packet: Packet;
  previousRounds: Round[];
  currentRound: Round;
}

export interface Player {
  playerMode: PlayerMode;
  playerStatus: PlayerStatus;
  playerId: string;
  playerSecret: string;
  name: string;
  gameOwner: boolean;
}

export interface PlayerSettings {
  maxPlayersPerTeam: number;
  numTeams: number;
  maxPlayers: number;
}

export interface Round {
  roundState: RoundState;
  roundNumber: number;
  currentBuzz: Buzz;
  buzzList: Buzz[];
  question: string;
  answer: string;
  proctorFinishedReading: boolean;
}

export interface Team {
  teamId: string;
  teamName: string;
  teamPlayers: Player[];
}

export type GameMode = "QUIZ_BOWL_CLASSIC";

export type JoinStatus = "SUCCESS" | "GAME_DOES_NOT_EXIST" | "SESSION_FULL" | "MODE_NOT_ALLOWED" | "MODE_FULL";

export type MatchState = "CONFIG" | "IN_GAME";

export type PlayerMode = "BUZZER" | "PROCTOR" | "SPECTATOR" | "DISPLAY";

export type PlayerStatus = "CONNECTED" | "DISCONNECTED";

export type ProctorType = "IN_PERSON_PROCTOR" | "ONLINE_PROCTOR" | "NO_PROCTOR";

export type RoundState = "PROCTOR_READING" | "AWAITING_BUZZ" | "AWAITING_ANSWER" | "COMPLETED";
