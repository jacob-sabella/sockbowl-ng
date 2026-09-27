import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  GlobalUsage,
  RateLimitEvent,
  ResetUsageRequest,
  SetQuotaOverrideRequest,
  UsagePage,
  UserUsageDetail,
} from '../models/usage-models';

/**
 * Client for the admin usage/quota API (`/api/v1/admin/usage/**`, plan
 * §2.8, WP G6). Every call requires `admin:access`; the bearer token is
 * attached by `AuthInterceptor`, and a 429/quota/limiter response is
 * surfaced by the global `RateLimitInterceptor` like any other call.
 */
@Injectable({
  providedIn: 'root',
})
export class UsageService {
  private http = inject(HttpClient);

  private readonly baseUrl: string = `${environment.apiBaseUrl}/api/v1/admin/usage`;

  list(page: number, size: number, q?: string, sort?: string): Observable<UsagePage> {
    let params = new HttpParams().set('page', page).set('size', size);
    if (q) {
      params = params.set('q', q);
    }
    if (sort) {
      params = params.set('sort', sort);
    }
    return this.http.get<UsagePage>(this.baseUrl, { params });
  }

  detail(sub: string): Observable<UserUsageDetail> {
    return this.http.get<UserUsageDetail>(`${this.baseUrl}/${encodeURIComponent(sub)}`);
  }

  global(): Observable<GlobalUsage> {
    return this.http.get<GlobalUsage>(`${this.baseUrl}/global`);
  }

  events(limit = 100): Observable<RateLimitEvent[]> {
    const params = new HttpParams().set('limit', limit);
    return this.http.get<RateLimitEvent[]>(`${this.baseUrl}/events`, { params });
  }

  /** Sets an override for `metric`, or clears it (back to the role default) when `limit` is `null`. */
  setQuotaOverride(sub: string, metric: string, limit: number | null): Observable<void> {
    const body: SetQuotaOverrideRequest = { limit };
    return this.http.put<void>(
      `${this.baseUrl}/${encodeURIComponent(sub)}/quota/${encodeURIComponent(metric)}`,
      body
    );
  }

  /** Deletes today's daily counters for `sub`; omit `metric` to reset all of them. */
  resetUsage(sub: string, metric?: string): Observable<void> {
    const body: ResetUsageRequest = metric ? { metric } : {};
    return this.http.post<void>(`${this.baseUrl}/${encodeURIComponent(sub)}/reset`, body);
  }
}
