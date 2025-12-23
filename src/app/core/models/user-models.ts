/**
 * User models for authentication and profile features
 */

export interface User {
  id: string;
  keycloakId: string;
  email: string;
  name: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface UserStats {
  id: string;
  userId: string;
  totalGames: number;
  totalWins: number;
  totalBuzzes: number;
  correctBuzzes: number;
  updatedAt: string;
}

export interface UserGameHistory {
  id: string;
  userId: string;
  gameSessionId: string;
  playerSessionId: string;
  joinedAt: string;
  finalScore: number | null;
  teamName: string | null;
}

export interface UserProfile {
  user: User;
  stats: UserStats;
}

export interface UserStatsResponse {
  id: string;
  userId: string;
  totalGames: number;
  totalWins: number;
  totalBuzzes: number;
  correctBuzzes: number;
  updatedAt: string;
}

export interface UserGameHistoryResponse {
  content: UserGameHistory[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}
