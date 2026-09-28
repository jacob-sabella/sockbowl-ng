import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { GraphqlClientService } from './graphql-client.service';
import { GraphqlRequestError } from './graphql-errors';

describe('GraphqlClientService', () => {
  const URL = 'http://questions.sockbowl.test/graphql';

  let service: GraphqlClientService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), GraphqlClientService]
    });
    service = TestBed.inject(GraphqlClientService);
    httpMock = TestBed.inject(HttpTestingController);
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
});
