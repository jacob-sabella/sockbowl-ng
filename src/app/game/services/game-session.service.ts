import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {CreateGameRequest} from "../models/http/create-game-request";
import {GameSessionIdentifiers} from "../models/game-session-identifiers";
import {JoinGameRequest} from "../models/http/join-game-request";
import {JoinGameResponse} from "../models/http/join-game-response";
@Injectable({
  providedIn: 'root'
})
export class GameSessionService {

  private baseUrl: string = 'http://localhost:8080/api/v1/session';

  constructor(private http: HttpClient) { }

  // Method to create a new game session
  createNewGame(request: CreateGameRequest): Observable<GameSessionIdentifiers> {
    const url = `${this.baseUrl}/create-new-game-session`;
    return this.http.post<GameSessionIdentifiers>(url, request);
  }

  // Method to join a game session
  joinGame(request: JoinGameRequest): Observable<JoinGameResponse> {
    const url = `${this.baseUrl}/join-game-session-by-code`;
    return this.http.post<JoinGameResponse>(url, request);
  }
}
