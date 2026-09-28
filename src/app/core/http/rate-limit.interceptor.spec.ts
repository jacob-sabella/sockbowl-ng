import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';

import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RateLimitStateService } from './rate-limit-state.service';

describe('RateLimitInterceptor', () => {
  const URL = 'http://api.sockbowl.test/api/v1/session/create-new-game-session';

  let http: HttpClient;
  let httpMock: HttpTestingController;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let state: RateLimitStateService;

  beforeEach(() => {
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: RateLimitInterceptor, multi: true },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    state = TestBed.inject(RateLimitStateService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('a 429 rate_limited shows the slow-down snackbar and sets a cooldown that clears after Retry-After seconds', fakeAsync(() => {
    let error: HttpErrorResponse | undefined;
    http.post(URL, {}).subscribe({ error: e => (error = e) });

    httpMock.expectOne(URL).flush(
      { error: 'rate_limited', policy: 'session-create', retryAfterSeconds: 5, message: 'Too many requests' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '5' } }
    );

    expect(error?.status).toBe(429);
    expect(snackBarSpy.open).toHaveBeenCalledWith(
      jasmine.stringContaining('5s'), 'Dismiss', jasmine.any(Object));
    expect(state.cooldown('session-create')()).toBe(5);

    tick(5000);
    expect(state.cooldown('session-create')()).toBe(0);
  }));

  it('a 429 quota_exceeded shows the metric label and limit', () => {
    http.post(URL, {}).subscribe({ error: () => undefined });

    httpMock.expectOne(URL).flush(
      { error: 'quota_exceeded', metric: 'ai.generations', limit: 20, used: 20, resetsAt: null },
      { status: 429, statusText: 'Too Many Requests' }
    );

    const [message] = snackBarSpy.open.calls.mostRecent().args;
    expect(message).toContain('AI generation');
    expect(message).toContain('20');
  });

  it('a 503 limiter_unavailable shows its own message', () => {
    http.post(URL, {}).subscribe({ error: () => undefined });

    httpMock.expectOne(URL).flush(
      { error: 'limiter_unavailable', policy: 'ai-generate' },
      { status: 503, statusText: 'Service Unavailable' }
    );

    expect(snackBarSpy.open).toHaveBeenCalledWith(
      'AI generation is temporarily unavailable', 'Dismiss', jasmine.any(Object));
  });

  it('non-limit errors pass through untouched with no snackbar', () => {
    let error: HttpErrorResponse | undefined;
    http.post(URL, {}).subscribe({ error: e => (error = e) });

    httpMock.expectOne(URL).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(error?.status).toBe(500);
    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });

  it('a 403 banned response is left alone (AuthInterceptor already surfaces it)', () => {
    http.post(URL, {}).subscribe({ error: () => undefined });

    httpMock.expectOne(URL).flush({ error: 'banned', reason: 'spam', expiresAt: null },
      { status: 403, statusText: 'Forbidden' });

    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });
});
