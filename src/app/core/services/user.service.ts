import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  UserStatsResponse,
  UserGameHistoryResponse,
  User
} from '../models/user-models';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private baseUrl: string = environment.sockbowlGameApiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get current user information
   */
  getCurrentUser(): Observable<User> {
    const url = `${this.baseUrl}/api/v1/auth/me`;
    return this.http.get<User>(url);
  }

  /**
   * Get user statistics (total games, wins, buzzes, etc.)
   * Requires authentication
   */
  getUserStats(): Observable<UserStatsResponse> {
    const url = `${this.baseUrl}/api/v1/user/stats`;
    return this.http.get<UserStatsResponse>(url);
  }

  /**
   * Get user game history with pagination
   * Requires authentication
   *
   * @param page Page number (0-indexed)
   * @param size Number of items per page
   */
  getUserHistory(page: number = 0, size: number = 10): Observable<UserGameHistoryResponse> {
    const url = `${this.baseUrl}/api/v1/user/history`;
    const params = new HttpParams()
      .set('page', page.toString())
      .set('size', size.toString())
      .set('sort', 'joinedAt,desc');

    return this.http.get<UserGameHistoryResponse>(url, { params });
  }
}
