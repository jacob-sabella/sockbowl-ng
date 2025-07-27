import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateGameRequest,
  GameSessionIdentifiers,
  JoinGameRequest,
  JoinGameResponse
} from "../models/sockbowl/sockbowl-interfaces";
import {environment} from "../../../environments/environment";
@Injectable({
  providedIn: 'root'
})
export class GameSessionService {

  private baseUrl: string = environment.sockbowlGameApiUrl;

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
