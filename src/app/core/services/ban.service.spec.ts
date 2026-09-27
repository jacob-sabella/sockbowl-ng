import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { BanService } from './ban.service';
import { environment } from '../../../environments/environment';

describe('BanService', () => {
  let service: BanService;
  let httpMock: HttpTestingController;
  const baseUrl = `${environment.apiBaseUrl}/api/v1/admin/bans`;
  const ipBaseUrl = `${baseUrl}/ip`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(BanService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('listBans() GETs the subject-ban list', () => {
    service.listBans().subscribe();
    const req = httpMock.expectOne(baseUrl);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('createBan() POSTs the ban request', () => {
    service.createBan({ bannedKeycloakId: 'sub-1', reason: 'spam' }).subscribe();
    const req = httpMock.expectOne(baseUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ bannedKeycloakId: 'sub-1', reason: 'spam' });
    req.flush({});
  });

  it('removeBan() DELETEs /{id}', () => {
    service.removeBan('ban-1').subscribe();
    const req = httpMock.expectOne(`${baseUrl}/ban-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('listIpBans() GETs /ip', () => {
    service.listIpBans().subscribe();
    const req = httpMock.expectOne(ipBaseUrl);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('createIpBan() POSTs /ip with the CIDR and TTL', () => {
    service.createIpBan({ cidr: '203.0.113.5/32', reason: 'flood', ttlSeconds: 3600 }).subscribe();
    const req = httpMock.expectOne(ipBaseUrl);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ cidr: '203.0.113.5/32', reason: 'flood', ttlSeconds: 3600 });
    req.flush({});
  });

  it('removeIpBan() DELETEs /ip/{id}', () => {
    service.removeIpBan('ipban-1').subscribe();
    const req = httpMock.expectOne(`${ipBaseUrl}/ipban-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
