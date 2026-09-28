import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { SockbowlQuestionsService } from './sockbowl-questions.service';
import { GraphqlRequestError } from '../../core/graphql/graphql-errors';
import { environment } from '../../../environments/environment';

describe('SockbowlQuestionsService', () => {
  const URL = environment.sockbowlQuestionsApiUrl + 'graphql';

  let service: SockbowlQuestionsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), SockbowlQuestionsService]
    });
    service = TestBed.inject(SockbowlQuestionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listPackets sends the filter, page and size and returns the page', () => {
    let result: any;
    service.listPackets({ mine: true, nameContains: 'sci' }, 1, 10).subscribe(r => (result = r));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({
      filter: { mine: true, nameContains: 'sci' },
      page: 1,
      size: 10
    });
    req.flush({
      data: {
        packets: {
          items: [{ id: 'p1', name: 'Packet 1', visibility: 'PUBLISHED', version: 2, tossupCount: 20, bonusCount: 20, playable: true }],
          total: 1,
          page: 1,
          size: 10
        }
      }
    });

    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('p1');
  });

  it('listPackets defaults filter to null and page/size to 0/25', () => {
    service.listPackets().subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ filter: null, page: 0, size: 25 });
    req.flush({ data: { packets: { items: [], total: 0, page: 0, size: 25 } } });
  });

  it('exportPacket returns the plaintext string', () => {
    let result: string | undefined;
    service.exportPacket('p1').subscribe(text => (result = text));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'p1', format: 'PLAINTEXT' });
    req.flush({ data: { exportPacket: '1. Q\nANSWER: A\n' } });

    expect(result).toBe('1. Q\nANSWER: A\n');
  });

  it('getPacketById sorts each bonus\'s parts by relationship order', () => {
    let result: any;
    service.getPacketById('p1').subscribe(p => (result = p));

    const req = httpMock.expectOne(URL);
    req.flush({
      data: {
        getPacketById: {
          id: 'p1',
          name: 'Packet 1',
          bonuses: [
            {
              order: 0,
              bonus: {
                id: 'b1',
                bonusParts: [
                  { order: 2, bonusPart: { id: 'bp3' } },
                  { order: 0, bonusPart: { id: 'bp1' } },
                  { order: 1, bonusPart: { id: 'bp2' } }
                ]
              }
            }
          ],
          tossups: []
        }
      }
    });

    expect(result.bonuses[0].bonus.bonusParts.map((bp: any) => bp.bonusPart.id)).toEqual(['bp1', 'bp2', 'bp3']);
  });

  it('surfaces a GraphQL error as a GraphqlRequestError (PB-01)', () => {
    let error: GraphqlRequestError | undefined;
    service.getPacketById('missing').subscribe({ error: (err) => (error = err) });

    const req = httpMock.expectOne(URL);
    req.flush({ errors: [{ message: 'Not found', extensions: { classification: 'NOT_FOUND' } }] });

    expect(error).toBeInstanceOf(GraphqlRequestError);
    expect(error?.classification).toBe('NOT_FOUND');
    expect(error?.message).toBe('Not found');
  });

  it('surfaces an HTTP transport failure (e.g. 429) as a GraphqlRequestError too', () => {
    let error: GraphqlRequestError | undefined;
    service.searchPacketsByName('sci').subscribe({ error: (err) => (error = err) });

    const req = httpMock.expectOne(URL);
    req.flush('Too many requests', { status: 429, statusText: 'Too Many Requests' });

    expect(error).toBeInstanceOf(GraphqlRequestError);
    expect(error?.classification).toBe('RATE_LIMITED');
  });
});

// M4 (generate GET -> POST, LLM headers) coverage, kept alongside M3's GraphQL coverage.
describe('SockbowlQuestionsService.generatePacket', () => {
  let service: SockbowlQuestionsService;
  let httpMock: HttpTestingController;
  const generateUrl = `${environment.sockbowlQuestionsApiUrl}api/packets/generate`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(SockbowlQuestionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('moves the generate call to POST with a JSON body (M4: generate GET -> POST)', () => {
    service.generatePacket('Ancient Rome', 'Focus on emperors', 'sk-test', 'gpt-5', 10, true).subscribe();

    const req = httpMock.expectOne(generateUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      topic: 'Ancient Rome',
      additionalContext: 'Focus on emperors',
      questionCount: 10,
      generateBonuses: true,
    });
    req.flush({ id: 'p1', name: 'Ancient Rome', bonuses: [], tossups: [] });
  });

  it('sends the API-key/model headers and the optional LLM-parameter headers', () => {
    service.generatePacket('Topic', '', 'sk-test', 'gpt-5', 5, false, 0.7, 0.9, 0.1, 0.2).subscribe();

    const req = httpMock.expectOne(generateUrl);
    expect(req.request.headers.get('X-API-Key')).toBe('sk-test');
    expect(req.request.headers.get('X-Model')).toBe('gpt-5');
    expect(req.request.headers.get('X-Temperature')).toBe('0.7');
    expect(req.request.headers.get('X-Top-P')).toBe('0.9');
    expect(req.request.headers.get('X-Frequency-Penalty')).toBe('0.1');
    expect(req.request.headers.get('X-Presence-Penalty')).toBe('0.2');
    // No additionalContext was supplied, so it's omitted from the body rather than sent blank.
    expect(req.request.body.additionalContext).toBeUndefined();
    req.flush({ id: 'p1', name: 'Topic', bonuses: [], tossups: [] });
  });

  it('sorts nested bonus parts by relationship order in the response', () => {
    let result: any;
    service.generatePacket('Topic', '', 'sk-test', 'gpt-5').subscribe(p => (result = p));

    httpMock.expectOne(generateUrl).flush({
      id: 'p1',
      name: 'Topic',
      tossups: [],
      bonuses: [{
        order: 0,
        bonus: {
          id: 'b1',
          bonusParts: [{ order: 2 }, { order: 0 }, { order: 1 }],
        },
      }],
    });

    expect(result.bonuses[0].bonus.bonusParts.map((p: any) => p.order)).toEqual([0, 1, 2]);
  });
});
