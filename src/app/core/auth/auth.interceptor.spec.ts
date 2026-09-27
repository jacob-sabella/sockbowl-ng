import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { OAuthService } from 'angular-oauth2-oidc';

import { AuthInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

describe('AuthInterceptor', () => {
  const API_BASE = 'http://api.sockbowl.test:7443';
  const QUESTIONS = 'http://questions.sockbowl.test:7009/';
  const OPENAI = 'https://api.openai.com/v1/chat/completions';

  let http: HttpClient;
  let httpMock: HttpTestingController;
  let oauthSpy: jasmine.SpyObj<OAuthService>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let saved: { authEnabled: boolean; apiBaseUrl: string; sockbowlQuestionsApiUrl: string };

  beforeEach(() => {
    // The allowlist is read when the interceptor is constructed (on the first
    // request), so the environment is set before any request is made. A
    // distinct apiBaseUrl origin proves it is on the list in its own right.
    saved = {
      authEnabled: environment.authEnabled,
      apiBaseUrl: environment.apiBaseUrl,
      sockbowlQuestionsApiUrl: environment.sockbowlQuestionsApiUrl,
    };
    environment.authEnabled = true;
    environment.apiBaseUrl = API_BASE;
    environment.sockbowlQuestionsApiUrl = QUESTIONS;

    oauthSpy = jasmine.createSpyObj('OAuthService', ['getAccessToken']);
    oauthSpy.getAccessToken.and.returnValue('token-1');
    authSpy = jasmine.createSpyObj('AuthService', ['refreshToken', 'handleSessionEnded']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
        { provide: OAuthService, useValue: oauthSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    environment.authEnabled = saved.authEnabled;
    environment.apiBaseUrl = saved.apiBaseUrl;
    environment.sockbowlQuestionsApiUrl = saved.sockbowlQuestionsApiUrl;
  });

  describe('bearer allowlist', () => {
    it('attaches the bearer to apiBaseUrl', () => {
      http.get(`${API_BASE}/api/v1/admin/bans`).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/api/v1/admin/bans`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
      req.flush([]);
    });

    it('attaches the bearer to the questions API and to relative URLs', () => {
      http.post(`${QUESTIONS}graphql`, {}).subscribe();
      http.get('/assets/something.json').subscribe();
      const gql = httpMock.expectOne(`${QUESTIONS}graphql`);
      const rel = httpMock.expectOne('/assets/something.json');
      expect(gql.request.headers.get('Authorization')).toBe('Bearer token-1');
      expect(rel.request.headers.get('Authorization')).toBe('Bearer token-1');
      gql.flush({});
      rel.flush({});
    });

    it('never sends the bearer to api.openai.com and keeps the caller\'s own header', () => {
      http.post(OPENAI, {}, { headers: { Authorization: 'Bearer sk-user' } }).subscribe();
      http.get('https://api.openai.com/v1/models').subscribe();
      const chat = httpMock.expectOne(OPENAI);
      const models = httpMock.expectOne('https://api.openai.com/v1/models');
      expect(chat.request.headers.get('Authorization')).toBe('Bearer sk-user');
      expect(models.request.headers.has('Authorization')).toBeFalse();
      chat.flush({});
      models.flush({});
    });

    it('does not send the bearer to an unlisted origin that merely looks similar', () => {
      http.get('http://api.sockbowl.test.evil.example/x').subscribe();
      const req = httpMock.expectOne('http://api.sockbowl.test.evil.example/x');
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });

    it('attaches nothing when auth is off', () => {
      environment.authEnabled = false;
      http.get(`${API_BASE}/api/v1/auth/me`).subscribe();
      const req = httpMock.expectOne(`${API_BASE}/api/v1/auth/me`);
      expect(req.request.headers.has('Authorization')).toBeFalse();
      req.flush({});
    });
  });

  describe('401 handling', () => {
    const url = `${API_BASE}/api/v1/user/profile`;

    it('refreshes once and retries once with the new token', fakeAsync(() => {
      authSpy.refreshToken.and.returnValue(Promise.resolve('token-2'));
      let body: unknown;
      http.get(url).subscribe(b => (body = b));

      const first = httpMock.expectOne(url);
      expect(first.request.headers.get('Authorization')).toBe('Bearer token-1');
      first.flush('expired', { status: 401, statusText: 'Unauthorized' });
      flushMicrotasks();

      expect(authSpy.refreshToken).toHaveBeenCalledTimes(1);
      const retry = httpMock.expectOne(url);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer token-2');
      retry.flush({ ok: true });

      expect(body).toEqual({ ok: true });
      expect(authSpy.handleSessionEnded).not.toHaveBeenCalled();
    }));

    it('a second 401 ends the session with no further refresh or retry', fakeAsync(() => {
      authSpy.refreshToken.and.returnValue(Promise.resolve('token-2'));
      let error: HttpErrorResponse | undefined;
      http.get(url).subscribe({ error: e => (error = e) });

      httpMock.expectOne(url).flush('expired', { status: 401, statusText: 'Unauthorized' });
      flushMicrotasks();
      httpMock.expectOne(url).flush('still no', { status: 401, statusText: 'Unauthorized' });
      flushMicrotasks();

      httpMock.expectNone(url);
      expect(authSpy.refreshToken).toHaveBeenCalledTimes(1);
      expect(authSpy.handleSessionEnded).toHaveBeenCalledTimes(1);
      expect(error?.status).toBe(401);
    }));

    it('a failed refresh ends the session and surfaces the original 401 without retrying', fakeAsync(() => {
      authSpy.refreshToken.and.returnValue(Promise.reject(new Error('invalid_grant')));
      let error: HttpErrorResponse | undefined;
      http.get(url).subscribe({ error: e => (error = e) });

      httpMock.expectOne(url).flush('expired', { status: 401, statusText: 'Unauthorized' });
      flushMicrotasks();

      httpMock.expectNone(url);
      expect(authSpy.handleSessionEnded).toHaveBeenCalledTimes(1);
      expect(error?.status).toBe(401);
    }));

    it('does not refresh for an anonymous request', () => {
      oauthSpy.getAccessToken.and.returnValue(null as unknown as string);
      let error: HttpErrorResponse | undefined;
      http.get(url).subscribe({ error: e => (error = e) });

      httpMock.expectOne(url).flush('login', { status: 401, statusText: 'Unauthorized' });

      expect(authSpy.refreshToken).not.toHaveBeenCalled();
      expect(authSpy.handleSessionEnded).not.toHaveBeenCalled();
      expect(error?.status).toBe(401);
    });

    it('does not refresh for a 401 from a third-party origin', () => {
      let error: HttpErrorResponse | undefined;
      http.post(OPENAI, {}).subscribe({ error: e => (error = e) });

      httpMock.expectOne(OPENAI).flush('bad key', { status: 401, statusText: 'Unauthorized' });

      expect(authSpy.refreshToken).not.toHaveBeenCalled();
      expect(error?.status).toBe(401);
    });
  });

  describe('403 handling', () => {
    it('shows the server message in a snackbar and rethrows', () => {
      let error: HttpErrorResponse | undefined;
      http.post(`${API_BASE}/api/v1/session/create-new-game-session`, {}).subscribe({ error: e => (error = e) });

      httpMock
        .expectOne(`${API_BASE}/api/v1/session/create-new-game-session`)
        .flush({ message: 'You are banned.' }, { status: 403, statusText: 'Forbidden' });

      expect(snackBarSpy.open).toHaveBeenCalledWith('You are banned.', 'Dismiss', jasmine.any(Object));
      expect(error?.status).toBe(403);
      expect(authSpy.refreshToken).not.toHaveBeenCalled();
    });

    it('falls back to a generic message', () => {
      http.get(`${API_BASE}/api/v1/admin/bans`).subscribe({ error: () => undefined });
      httpMock.expectOne(`${API_BASE}/api/v1/admin/bans`).flush(null, { status: 403, statusText: 'Forbidden' });
      expect(snackBarSpy.open).toHaveBeenCalledWith(
        'You do not have permission to perform this action.', 'Dismiss', jasmine.any(Object));
    });

    it('shows the snackbar when the retry after a refresh returns 403', fakeAsync(() => {
      authSpy.refreshToken.and.returnValue(Promise.resolve('token-2'));
      const url = `${API_BASE}/api/v1/admin/bans`;
      http.get(url).subscribe({ error: () => undefined });

      httpMock.expectOne(url).flush('expired', { status: 401, statusText: 'Unauthorized' });
      flushMicrotasks();
      httpMock.expectOne(url).flush({ message: 'Forbidden here.' }, { status: 403, statusText: 'Forbidden' });

      expect(snackBarSpy.open).toHaveBeenCalledWith('Forbidden here.', 'Dismiss', jasmine.any(Object));
      expect(authSpy.handleSessionEnded).not.toHaveBeenCalled();
    }));
  });
});
