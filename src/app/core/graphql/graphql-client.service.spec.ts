import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GraphqlClientService } from './graphql-client.service';
import { GraphqlRequestError } from './graphql-errors';
import { RateLimitStateService } from '../http/rate-limit-state.service';

describe('GraphqlClientService', () => {
  const URL = 'http://questions.sockbowl.test/graphql';

  let service: GraphqlClientService;
  let httpMock: HttpTestingController;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let rateLimitState: RateLimitStateService;

  beforeEach(() => {
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        GraphqlClientService,
        { provide: MatSnackBar, useValue: snackBarSpy },
      ]
    });
    service = TestBed.inject(GraphqlClientService);
    httpMock = TestBed.inject(HttpTestingController);
    rateLimitState = TestBed.inject(RateLimitStateService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('unwraps `data` on success', () => {
    let result: { widget: { id: string } } | undefined;
    service.request<{ widget: { id: string } }>(URL, 'query { widget { id } }', {}).subscribe((d) => (result = d));

    const req = httpMock.expectOne(URL);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { widget: { id: 'w1' } } });

    expect(result).toEqual({ widget: { id: 'w1' } });
  });

  it('sends the query and variables in the POST body', () => {
    service.request(URL, 'query ($id: ID!) { widget(id: $id) { id } }', { id: 'w1' }).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body).toEqual({ query: 'query ($id: ID!) { widget(id: $id) { id } }', variables: { id: 'w1' } });
    req.flush({ data: {} });
  });

  it('throws a GraphqlRequestError carrying the classification and extensions when the body has `errors`', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'mutation { doThing { id } }', {}).subscribe({
      error: (err) => (error = err)
    });

    const req = httpMock.expectOne(URL);
    req.flush({
      data: null,
      errors: [
        {
          message: 'Stale version',
          path: ['doThing'],
          extensions: { classification: 'CONFLICT', packetId: 'p1', currentVersion: 4 }
        }
      ]
    });

    expect(error).toBeInstanceOf(GraphqlRequestError);
    expect(error?.message).toBe('Stale version');
    expect(error?.classification).toBe('CONFLICT');
    expect(error?.extensions).toEqual({ classification: 'CONFLICT', packetId: 'p1', currentVersion: 4 });
    expect(error?.path).toEqual(['doThing']);
    expect(error?.all.length).toBe(1);
  });

  it('collects every error into `all` when the body carries more than one', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'mutation { a b }', {}).subscribe({ error: (err) => (error = err) });

    const req = httpMock.expectOne(URL);
    req.flush({
      errors: [
        { message: 'first', extensions: { classification: 'VALIDATION_FAILED' } },
        { message: 'second', extensions: { classification: 'BAD_REQUEST' } }
      ]
    });

    expect(error?.classification).toBe('VALIDATION_FAILED');
    expect(error?.all.length).toBe(2);
    expect(error?.all[1].message).toBe('second');
  });

  it('classifies HTTP 401 as UNAUTHORIZED', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

    expect(error?.classification).toBe('UNAUTHORIZED');
    expect(error?.httpStatus).toBe(401);
  });

  it('classifies HTTP 403 as FORBIDDEN', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('Forbidden', { status: 403, statusText: 'Forbidden' });

    expect(error?.classification).toBe('FORBIDDEN');
  });

  it('classifies HTTP 413 as PAYLOAD_TOO_LARGE', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('Too large', { status: 413, statusText: 'Payload Too Large' });

    expect(error?.classification).toBe('PAYLOAD_TOO_LARGE');
  });

  it('classifies HTTP 429 as RATE_LIMITED', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('Too many requests', { status: 429, statusText: 'Too Many Requests' });

    expect(error?.classification).toBe('RATE_LIMITED');
  });

  it('classifies a network failure (status 0) as NETWORK', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('', { status: 0, statusText: 'Unknown Error' });

    expect(error?.classification).toBe('NETWORK');
  });

  it('classifies a 5xx failure as INTERNAL_ERROR', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock.expectOne(URL).flush('Boom', { status: 503, statusText: 'Service Unavailable' });

    expect(error?.classification).toBe('INTERNAL_ERROR');
  });

  it('prefers a GraphQL `errors` body over the HTTP status when both are present', () => {
    let error: GraphqlRequestError | undefined;
    service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

    httpMock
      .expectOne(URL)
      .flush({ errors: [{ message: 'Quota used up', extensions: { classification: 'QUOTA_EXCEEDED' } }] }, { status: 429, statusText: 'Too Many Requests' });

    expect(error?.classification).toBe('QUOTA_EXCEEDED');
    expect(error?.httpStatus).toBe(429);
  });

  // INT1 (M4-UI-01's M3-dependent tail): a GraphQL-level RATE_LIMITED/
  // QUOTA_EXCEEDED/BANNED classification always arrives over HTTP 200
  // (questions' RateLimitingInstrumentation + LimitsGraphQlExceptionResolver),
  // so RateLimitInterceptor -- which only reacts to a real 429/503/403 --
  // never sees or reports it. GraphqlClientService is the only place that
  // does, via notifyLimit.
  describe('INT1: notifyLimit for GraphQL-level limit classifications', () => {
    it('a RATE_LIMITED GraphQL error (HTTP 200) shows the slow-down snackbar and sets a cooldown that clears after Retry-After seconds', fakeAsync(() => {
      let error: GraphqlRequestError | undefined;
      service.request(URL, 'mutation { importPacket(input: {}) { committed } }', {}).subscribe({
        error: (err) => (error = err)
      });

      httpMock.expectOne(URL).flush({
        data: null,
        errors: [
          {
            message: 'Too many requests',
            extensions: { classification: 'RATE_LIMITED', error: 'rate_limited', policy: 'import', retryAfterSeconds: 5 }
          }
        ]
      });

      expect(error?.classification).toBe('RATE_LIMITED');
      expect(snackBarSpy.open).toHaveBeenCalledWith(
        jasmine.stringContaining('5s'), 'Dismiss', jasmine.any(Object));
      expect(rateLimitState.cooldown('import')()).toBe(5);

      tick(5000);
      expect(rateLimitState.cooldown('import')()).toBe(0);
    }));

    it('a QUOTA_EXCEEDED GraphQL error (HTTP 200) shows the metric label', () => {
      service.request(URL, 'mutation { importPacket(input: {}) { committed } }', {}).subscribe({ error: () => undefined });

      httpMock.expectOne(URL).flush({
        errors: [
          {
            message: 'Quota used up',
            extensions: { classification: 'QUOTA_EXCEEDED', error: 'quota_exceeded', metric: 'imports', limit: 5, used: 5, resetsAt: null }
          }
        ]
      });

      const [message] = snackBarSpy.open.calls.mostRecent().args;
      expect(message).toContain('5');
    });

    it('a BANNED GraphQL error (HTTP 200) shows the banned snackbar', () => {
      service.request(URL, 'mutation { clonePacket(id: "p1") { id } }', {}).subscribe({ error: () => undefined });

      httpMock.expectOne(URL).flush({
        errors: [
          {
            message: 'Banned',
            extensions: { classification: 'BANNED', error: 'banned', reason: 'spam', expiresAt: null }
          }
        ]
      });

      expect(snackBarSpy.open).toHaveBeenCalledWith(
        jasmine.stringMatching(/banned/i), 'Dismiss', jasmine.any(Object));
    });

    it('a non-limit classification (e.g. CONFLICT) never calls the snackbar', () => {
      service.request(URL, 'mutation { renamePacket(id: "p1", name: "x") { id } }', {}).subscribe({ error: () => undefined });

      httpMock.expectOne(URL).flush({
        errors: [{ message: 'Stale version', extensions: { classification: 'CONFLICT' } }]
      });

      expect(snackBarSpy.open).not.toHaveBeenCalled();
    });

    // Single-snackbar rule (INT1): an HTTP 429 on /graphql is RateLimitInterceptor's
    // to report (the coarse graphql-http REST policy or a ban never reaches GraphQL
    // execution at all). isLimitHandled recognizes that exact classified shape, so
    // this client must stay silent for it -- showing it too would double the snackbar.
    it('an HTTP 429 with a classified rate_limited body is NOT re-notified (RateLimitInterceptor already handled it)', () => {
      let error: GraphqlRequestError | undefined;
      service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

      httpMock.expectOne(URL).flush(
        { error: 'rate_limited', policy: 'graphql-http', retryAfterSeconds: 5, message: 'Too many requests' },
        { status: 429, statusText: 'Too Many Requests' }
      );

      expect(error?.classification).toBe('RATE_LIMITED');
      expect(snackBarSpy.open).not.toHaveBeenCalled();
    });

    it('an HTTP 403 with a classified banned body is NOT re-notified (RateLimitInterceptor already handled it)', () => {
      service.request(URL, 'query { x }', {}).subscribe({ error: () => undefined });

      httpMock.expectOne(URL).flush(
        { error: 'banned', reason: 'spam', expiresAt: null },
        { status: 403, statusText: 'Forbidden' }
      );

      expect(snackBarSpy.open).not.toHaveBeenCalled();
    });

    // An unclassified 429 (no recognizable body) was never shown by
    // RateLimitInterceptor either (it bails out when the body doesn't
    // classify) -- this client is the only backstop, so it still notifies,
    // with whatever generic information the bare status gives it.
    it('an HTTP 429 with an unclassified body still gets a fallback snackbar from this client', () => {
      let error: GraphqlRequestError | undefined;
      service.request(URL, 'query { x }', {}).subscribe({ error: (err) => (error = err) });

      httpMock.expectOne(URL).flush('Too many requests', { status: 429, statusText: 'Too Many Requests' });

      expect(error?.classification).toBe('RATE_LIMITED');
      expect(snackBarSpy.open).toHaveBeenCalled();
    });
  });
});
