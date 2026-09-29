import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { SavedAiKeyService, SavedAiKeyStatus, describeSavedAiKeyError } from './saved-ai-key.service';
import { environment } from '../../../environments/environment';

describe('SavedAiKeyService', () => {
  let service: SavedAiKeyService;
  let httpMock: HttpTestingController;
  const url = `${environment.sockbowlQuestionsApiUrl}api/me/ai-key`;

  const configured: SavedAiKeyStatus = {
    configured: true,
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    last4: 'AbCd',
    updatedAt: '2026-09-28T12:00:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SavedAiKeyService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('status$ GETs once and shares the cached result with later subscribers', () => {
    const seen: SavedAiKeyStatus[] = [];
    service.status$.subscribe(s => seen.push(s));
    service.status$.subscribe(s => seen.push(s));

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('GET');
    req.flush(configured);

    const late: SavedAiKeyStatus[] = [];
    service.status$.subscribe(s => late.push(s));

    expect(seen).toEqual([configured, configured]);
    expect(late).toEqual([configured]);
    httpMock.expectNone(url);
  });

  it('status$ reads a failed GET (e.g. 503, feature off) as not configured instead of erroring', () => {
    let status: SavedAiKeyStatus | undefined;
    let errored = false;
    service.status$.subscribe({ next: s => status = s, error: () => errored = true });

    httpMock.expectOne(url).flush('disabled', { status: 503, statusText: 'Service Unavailable' });

    expect(errored).toBeFalse();
    expect(status?.configured).toBeFalse();
  });

  it('refresh surfaces the error itself so the profile can tell a 503 apart', () => {
    let error: HttpErrorResponse | undefined;
    service.refresh().subscribe({ error: e => error = e });

    httpMock.expectOne(url).flush('disabled', { status: 503, statusText: 'Service Unavailable' });

    expect(error?.status).toBe(503);
  });

  it('save PUTs the key and model and updates the cached status', () => {
    let status: SavedAiKeyStatus | undefined;
    service.save('sk-ant-secret', 'claude-opus-5-5').subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ apiKey: 'sk-ant-secret', model: 'claude-opus-5-5' });
    req.flush({ ...configured, model: 'claude-opus-5-5' });

    service.status$.subscribe(s => status = s);
    httpMock.expectNone(url);
    expect(status?.model).toBe('claude-opus-5-5');
  });

  it('updateModel PATCHes just the model', () => {
    service.updateModel('claude-haiku-4-5-20251001').subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ model: 'claude-haiku-4-5-20251001' });
    req.flush({ ...configured, model: 'claude-haiku-4-5-20251001' });
  });

  it('remove DELETEs and marks the cache not configured', () => {
    let status: SavedAiKeyStatus | undefined;
    service.remove().subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });

    service.status$.subscribe(s => status = s);
    httpMock.expectNone(url);
    expect(status?.configured).toBeFalse();
  });

  it('listModels GETs the saved key\'s models', () => {
    let models: string[] = [];
    service.listModels().subscribe(m => models = m);

    httpMock.expectOne(`${url}/models`).flush(['claude-sonnet-5', 'claude-opus-5-5']);

    expect(models).toEqual(['claude-sonnet-5', 'claude-opus-5-5']);
  });

  it('never writes the key to browser storage', () => {
    const setLocal = spyOn(localStorage, 'setItem').and.callThrough();
    const setSession = spyOn(sessionStorage, 'setItem').and.callThrough();

    service.save('sk-ant-secret', 'claude-sonnet-5').subscribe();
    httpMock.expectOne(url).flush(configured);

    expect(setLocal).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });
});

describe('describeSavedAiKeyError', () => {
  it('uses a plain-text body as the message', () => {
    expect(describeSavedAiKeyError(new HttpErrorResponse({ status: 400, error: 'Invalid API key' })))
      .toBe('Invalid API key');
  });

  it('uses a JSON {message} body', () => {
    expect(describeSavedAiKeyError(new HttpErrorResponse({ status: 400, error: { message: 'Unknown model' } })))
      .toBe('Unknown model');
  });

  it('falls back to a generic message', () => {
    expect(describeSavedAiKeyError(new Error('boom'))).toContain('Something went wrong');
  });
});
