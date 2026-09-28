import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Ban, CreateBanRequest, CreateIpBanRequest, IpBan } from '../models/ban-models';

/**
 * Client for the admin ban-management endpoints (`/api/v1/admin/bans` and,
 * for M4-AB-02, `/api/v1/admin/bans/ip`). All calls require the caller to
 * hold `user:ban`; the JWT is attached by the auth interceptor.
 */
@Injectable({
  providedIn: 'root'
})
export class BanService {
  private http = inject(HttpClient);

  private readonly baseUrl: string =
    `${environment.apiBaseUrl}/api/v1/admin/bans`;

  private readonly ipBaseUrl: string = `${this.baseUrl}/ip`;

  listBans(): Observable<Ban[]> {
    return this.http.get<Ban[]>(this.baseUrl);
  }

  createBan(request: CreateBanRequest): Observable<Ban> {
    return this.http.post<Ban>(this.baseUrl, request);
  }

  removeBan(banId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${banId}`);
  }

  listIpBans(): Observable<IpBan[]> {
    return this.http.get<IpBan[]>(this.ipBaseUrl);
  }

  createIpBan(request: CreateIpBanRequest): Observable<IpBan> {
    return this.http.post<IpBan>(this.ipBaseUrl, request);
  }

  removeIpBan(banId: string): Observable<void> {
    return this.http.delete<void>(`${this.ipBaseUrl}/${banId}`);
  }
}
