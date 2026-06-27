import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Ban, CreateBanRequest } from '../models/ban-models';

/**
 * Client for the admin ban-management endpoints (`/api/v1/admin/bans`).
 * All calls require the caller to hold the `admin` realm role; the JWT is
 * attached by the auth interceptor.
 */
@Injectable({
  providedIn: 'root'
})
export class BanService {
  private readonly baseUrl: string =
    `${environment.apiBaseUrl || 'http://localhost:7000'}/api/v1/admin/bans`;

  constructor(private http: HttpClient) {}

  listBans(): Observable<Ban[]> {
    return this.http.get<Ban[]>(this.baseUrl);
  }

  createBan(request: CreateBanRequest): Observable<Ban> {
    return this.http.post<Ban>(this.baseUrl, request);
  }

  removeBan(banId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${banId}`);
  }
}
