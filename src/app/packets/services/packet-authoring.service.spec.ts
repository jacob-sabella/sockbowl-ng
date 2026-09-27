import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { PacketAuthoringService } from './packet-authoring.service';
import { GraphqlRequestError } from '../../core/graphql/graphql-errors';
import { environment } from '../../../environments/environment';

describe('PacketAuthoringService', () => {
  const URL = environment.sockbowlQuestionsApiUrl + 'graphql';

  let service: PacketAuthoringService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PacketAuthoringService]
    });
    service = TestBed.inject(PacketAuthoringService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('createPacket sends the input and returns the new id', () => {
    let result: string | undefined;
    service.createPacket({ name: 'New packet', difficultyId: 'd1' }).subscribe(id => (result = id));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ input: { name: 'New packet', difficultyId: 'd1' } });
    req.flush({ data: { createPacket: { id: 'p1' } } });

    expect(result).toBe('p1');
  });

  it('renamePacket omits expectedVersion (sends null) when not given, and includes it when given', () => {
    service.renamePacket('p1', 'New name').subscribe();
    let req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'p1', name: 'New name', expectedVersion: null });
    req.flush({ data: { renamePacket: { id: 'p1' } } });

    service.renamePacket('p1', 'New name', 3).subscribe();
    req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'p1', name: 'New name', expectedVersion: 3 });
    req.flush({ data: { renamePacket: { id: 'p1' } } });
  });

  it('deletePacket sends expectedVersion and returns the boolean result', () => {
    let result: boolean | undefined;
    service.deletePacket('p1', 5).subscribe(r => (result = r));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'p1', expectedVersion: 5 });
    req.flush({ data: { deletePacket: true } });

    expect(result).toBe(true);
  });

  it('addTossupToPacket sends order and expectedVersion alongside the input', () => {
    service.addTossupToPacket('p1', { question: 'Q', answer: 'A' }, 2, 7).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({
      packetId: 'p1',
      input: { question: 'Q', answer: 'A' },
      order: 2,
      expectedVersion: 7
    });
    req.flush({ data: { addTossupToPacket: { id: 't1' } } });
  });

  it('setTossupSubcategory sends a null subcategoryId to clear it (PB-09)', () => {
    service.setTossupSubcategory('t1', null, 4).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ tossupId: 't1', subcategoryId: null, expectedVersion: 4 });
    req.flush({ data: { setTossupSubcategory: { id: 't1' } } });
  });

  it('setBonusSubcategory sends a null subcategoryId to clear it (PB-09)', () => {
    service.setBonusSubcategory('b1', null).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ bonusId: 'b1', subcategoryId: null, expectedVersion: null });
    req.flush({ data: { setBonusSubcategory: { id: 'b1' } } });
  });

  it('setPacketVisibility sends the visibility and expectedVersion', () => {
    service.setPacketVisibility('p1', 'PUBLISHED', 9).subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.query).toContain('setPacketVisibility');
    expect(req.request.body.variables).toEqual({ id: 'p1', visibility: 'PUBLISHED', expectedVersion: 9 });
    req.flush({ data: { setPacketVisibility: { id: 'p1' } } });
  });

  it('clonePacket sends the source id and optional name', () => {
    let result: string | undefined;
    service.clonePacket('p1', 'Copy name').subscribe(id => (result = id));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'p1', name: 'Copy name' });
    req.flush({ data: { clonePacket: { id: 'p2' } } });

    expect(result).toBe('p2');
  });

  it('importPacket sends the ImportPacketInput and returns the full result shape', () => {
    let result: any;
    service
      .importPacket({ text: '1. Q\nANSWER: A', dryRun: true })
      .subscribe(r => (result = r));

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ input: { text: '1. Q\nANSWER: A', dryRun: true } });
    req.flush({
      data: {
        importPacket: {
          committed: false,
          packet: null,
          parsed: { suggestedName: null, tossups: [], bonuses: [] },
          issues: []
        }
      }
    });

    expect(result.committed).toBe(false);
  });

  it('renameCategory, mergeCategories and the other taxonomy admin ops send sourceId/targetId or id/name', () => {
    service.renameCategory('c1', 'Science').subscribe();
    let req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ id: 'c1', name: 'Science' });
    req.flush({ data: { renameCategory: { id: 'c1', name: 'Science' } } });

    service.mergeCategories('c1', 'c2').subscribe();
    req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({ sourceId: 'c1', targetId: 'c2' });
    req.flush({ data: { mergeCategories: { id: 'c2', name: 'Science' } } });
  });

  it('generateAndAddTossup sends apiKey/model and expectedVersion in the GenerateTossupInput/args', () => {
    service
      .generateAndAddTossup('p1', { topic: 'Space', apiKey: 'sk-1', model: 'gpt-4o' }, 1, 2)
      .subscribe();

    const req = httpMock.expectOne(URL);
    expect(req.request.body.variables).toEqual({
      packetId: 'p1',
      input: { topic: 'Space', apiKey: 'sk-1', model: 'gpt-4o' },
      order: 1,
      expectedVersion: 2
    });
    req.flush({ data: { generateAndAddTossup: { id: 't9' } } });
  });

  it('surfaces a GraphQL error as a GraphqlRequestError with its classification', () => {
    let error: GraphqlRequestError | undefined;
    service.setPacketVisibility('p1', 'PUBLISHED', 1).subscribe({ error: (err) => (error = err) });

    const req = httpMock.expectOne(URL);
    req.flush({
      data: null,
      errors: [{ message: 'Stale version', extensions: { classification: 'CONFLICT', currentVersion: 4 } }]
    });

    expect(error).toBeInstanceOf(GraphqlRequestError);
    expect(error?.classification).toBe('CONFLICT');
  });
});
