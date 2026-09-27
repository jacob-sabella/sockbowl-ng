import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
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
