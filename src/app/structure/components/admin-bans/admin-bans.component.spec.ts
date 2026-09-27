import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AdminBansComponent, validateCidr } from './admin-bans.component';
import { BanService } from '../../../core/services/ban.service';
import { AuthService } from '../../../core/auth/auth.service';
import { IpBan } from '../../../core/models/ban-models';

describe('validateCidr', () => {
  it('accepts a bare IPv4 address (treated as /32)', () => {
    expect(validateCidr('203.0.113.5')).toBeNull();
  });

  it('accepts an IPv4 CIDR at or narrower than /16', () => {
    expect(validateCidr('203.0.113.0/24')).toBeNull();
    expect(validateCidr('203.0.0.0/16')).toBeNull();
  });

  it('rejects an IPv4 range broader than /16', () => {
    expect(validateCidr('10.0.0.0/8')).toContain('/16');
  });

  it('rejects a malformed IPv4 address', () => {
    expect(validateCidr('999.1.1.1')).toContain('IPv4');
    expect(validateCidr('not-an-ip')).toBeTruthy();
  });

  it('rejects an IPv6 range broader than /48', () => {
    expect(validateCidr('2001:db8::/32')).toContain('/48');
  });

  it('accepts an IPv6 CIDR at or narrower than /48', () => {
    expect(validateCidr('2001:db8::/64')).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(validateCidr('  ')).toBeTruthy();
  });
});

describe('AdminBansComponent', () => {
  let fixture: ComponentFixture<AdminBansComponent>;
  let component: AdminBansComponent;
  let banServiceSpy: jasmine.SpyObj<BanService>;

  const ipBan: IpBan = {
    id: 'ipban-1',
    cidr: '203.0.113.5/32',
    reason: 'flood',
    bannedBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-02T00:00:00Z',
  };

  function configure(): void {
    banServiceSpy = jasmine.createSpyObj('BanService', [
      'listBans', 'createBan', 'removeBan',
      'listIpBans', 'createIpBan', 'removeIpBan',
    ]);
    banServiceSpy.listBans.and.returnValue(of([]));
    banServiceSpy.listIpBans.and.returnValue(of([ipBan]));
    banServiceSpy.createIpBan.and.returnValue(of(ipBan));
    banServiceSpy.removeIpBan.and.returnValue(of(undefined));

    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);

    TestBed.configureTestingModule({
      declarations: [AdminBansComponent],
      providers: [
        { provide: BanService, useValue: banServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(AdminBansComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads the IP ban list on init', () => {
    configure();
    expect(banServiceSpy.listIpBans).toHaveBeenCalled();
    expect(component.ipBans).toEqual([ipBan]);
  });

  it('refuses to submit an invalid CIDR without calling the service', () => {
    configure();
    component.newIpBan.cidr = '10.0.0.0/8';

    component.addIpBan();

    expect(component.ipCidrError).toContain('/16');
    expect(banServiceSpy.createIpBan).not.toHaveBeenCalled();
  });

  it('creates an IP ban and refreshes the list', () => {
    configure();
    component.newIpBan = { cidr: '203.0.113.5', reason: 'flood', ttlSeconds: 3600 };
    banServiceSpy.listIpBans.calls.reset();

    component.addIpBan();

    expect(banServiceSpy.createIpBan).toHaveBeenCalledWith({
      cidr: '203.0.113.5',
      reason: 'flood',
      ttlSeconds: 3600,
    });
    expect(banServiceSpy.listIpBans).toHaveBeenCalled();
    expect(component.ipCidrError).toBeNull();
  });

  it('surfaces a create failure without crashing', () => {
    configure();
    banServiceSpy.createIpBan.and.returnValue(throwError(() => ({ error: { message: 'nope' } })));
    component.newIpBan = { cidr: '203.0.113.5', reason: '', ttlSeconds: 3600 };

    component.addIpBan();

    expect(component.ipBanSubmitting).toBeFalse();
  });

  it('removes an IP ban and refreshes the list', () => {
    configure();
    banServiceSpy.listIpBans.calls.reset();

    component.removeIpBan(ipBan);

    expect(banServiceSpy.removeIpBan).toHaveBeenCalledWith('ipban-1');
    expect(banServiceSpy.listIpBans).toHaveBeenCalled();
  });
});
