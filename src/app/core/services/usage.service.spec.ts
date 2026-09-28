import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { UsageService } from './usage.service';
import { environment } from '../../../environments/environment';

describe('UsageService', () => {
  let service: UsageService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiBaseUrl}/api/v1/admin/usage`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(UsageService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('list() GETs the page with page/size/q/sort params', () => {
    service.list(2, 25, 'jane', 'lastSeen').subscribe();

    const req = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === baseUrl
    );
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('25');
    expect(req.request.params.get('q')).toBe('jane');
    expect(req.request.params.get('sort')).toBe('lastSeen');
    req.flush({ content: [], totalElements: 0, totalPages: 0, size: 25, number: 2 });
  });

  it('list() omits q/sort when not supplied', () => {
    service.list(0, 20).subscribe();

    const req = httpMock.expectOne((r) => r.method === 'GET' && r.url === baseUrl);
    expect(req.request.params.has('q')).toBeFalse();
    expect(req.request.params.has('sort')).toBeFalse();
    req.flush({ content: [], totalElements: 0, totalPages: 0, size: 20, number: 0 });
  });

  it('detail() GETs /{sub} and flattens the backend\'s nested summary + recentEvents into UserUsageDetail', () => {
    let result: any;
    service.detail('user-1').subscribe((d) => (result = d));

    const req = httpMock.expectOne(`${baseUrl}/user-1`);
    expect(req.request.method).toBe('GET');
    // The real wire shape (`AdminUsageService.getDetail`, game): the list
    // row nested under `summary`, and `recentEvents` rather than `events`.
    // Live evidence (WP-E1): flushing this exact shape without the
    // service's own flattening left `detail.counters`/`detail.events`
    // undefined and the admin detail panel silently empty.
    req.flush({
      summary: {
        keycloakId: 'user-1',
        username: 'u',
        displayName: 'U',
        tier: 'PLAYER',
        lastSeenAt: null,
        banned: false,
        activeSessions: 0,
        packetsOwned: 0,
        counters: [{ metric: 'hosted-sessions', used: 1, limit: 3, kind: 'concurrent', resetsAt: null, overridden: false }],
        recentRejections: 0,
      },
      lastIps: ['1.2.3.4'],
      overrides: {},
      recentEvents: [{ ts: 't', svc: 'game', policy: 'p', kind: 'rate', sub: null, ip: null, path: null }],
      hostedSessionIds: ['s1'],
    });

    expect(result.keycloakId).toBe('user-1');
    expect(result.counters.length).toBe(1);
    expect(result.lastIps).toEqual(['1.2.3.4']);
    expect(result.events.length).toBe(1);
    expect(result.hostedSessionIds).toEqual(['s1']);
  });

  it('global() GETs /global', () => {
    service.global().subscribe();

    const req = httpMock.expectOne(`${baseUrl}/global`);
    expect(req.request.method).toBe('GET');
    req.flush({
      aiServerKey: { used: 0, limit: 200, resetsAt: null },
      activeHostedSessions: 0,
      topGuestIps: [],
      rejectionsLastHour: 0,
    });
  });

  it('events() GETs /events with a limit param, defaulting to 100', () => {
    service.events().subscribe();
    let req = httpMock.expectOne((r) => r.method === 'GET' && r.url === `${baseUrl}/events`);
    expect(req.request.params.get('limit')).toBe('100');
    req.flush([]);

    service.events(25).subscribe();
    req = httpMock.expectOne((r) => r.method === 'GET' && r.url === `${baseUrl}/events`);
    expect(req.request.params.get('limit')).toBe('25');
    req.flush([]);
  });

  it('setQuotaOverride() PUTs /{sub}/quota/{metric} with the numeric limit', () => {
    service.setQuotaOverride('user-1', 'hosted-sessions', 4).subscribe();

    const req = httpMock.expectOne(`${baseUrl}/user-1/quota/hosted-sessions`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ limit: 4 });
    req.flush(null);
  });

  it('setQuotaOverride() sends null for "role default"', () => {
    service.setQuotaOverride('user-1', 'hosted-sessions', null).subscribe();

    const req = httpMock.expectOne(`${baseUrl}/user-1/quota/hosted-sessions`);
    expect(req.request.body).toEqual({ limit: null });
    req.flush(null);
  });

  it('resetUsage() POSTs /{sub}/reset with the metric when given', () => {
    service.resetUsage('user-1', 'ai.generations').subscribe();

    const req = httpMock.expectOne(`${baseUrl}/user-1/reset`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ metric: 'ai.generations' });
    req.flush(null);
  });

  it('resetUsage() POSTs an empty body to reset every daily counter', () => {
    service.resetUsage('user-1').subscribe();

    const req = httpMock.expectOne(`${baseUrl}/user-1/reset`);
    expect(req.request.body).toEqual({});
    req.flush(null);
  });
});
