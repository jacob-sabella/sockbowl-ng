import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { SockbowlQuestionsService } from './sockbowl-questions.service';
import { environment } from '../../../environments/environment';

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
