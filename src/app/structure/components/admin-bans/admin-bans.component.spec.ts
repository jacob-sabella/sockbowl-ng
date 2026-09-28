import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';

import { AdminBansComponent, validateCidr } from './admin-bans.component';
import { BanService } from '../../../core/services/ban.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { Ban, IpBan } from '../../../core/models/ban-models';

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
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let confirmDialogServiceSpy: jasmine.SpyObj<ConfirmDialogService>;
  /** Captures the action-button subscription each `snackBar.open(...)` call wires up, so a test can fire Undo. */
  let snackBarActionSubjects: Subject<void>[];

  const ipBan: IpBan = {
    id: 'ipban-1',
    cidr: '203.0.113.5/32',
    reason: 'flood',
    bannedBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-02T00:00:00Z',
  };

  const activeBan: Ban = {
    id: 'ban-1',
    bannedKeycloakId: 'user-9',
    reason: 'flood',
    bannedBy: 'admin-1',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: null,
  };

  const createdBan: Ban = activeBan;

  /** Defaults every confirmation to "confirmed"; a test overrides with `.and.returnValue(of(false))` to check cancel. */
  function configure(confirmed = true): void {
    banServiceSpy = jasmine.createSpyObj('BanService', [
      'listBans', 'createBan', 'removeBan',
      'listIpBans', 'createIpBan', 'removeIpBan',
    ]);
    banServiceSpy.listBans.and.returnValue(of([]));
    banServiceSpy.listIpBans.and.returnValue(of([ipBan]));
    banServiceSpy.createBan.and.returnValue(of(createdBan));
    banServiceSpy.createIpBan.and.returnValue(of(ipBan));
    banServiceSpy.removeBan.and.returnValue(of(undefined));
    banServiceSpy.removeIpBan.and.returnValue(of(undefined));

    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);

    confirmDialogServiceSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    confirmDialogServiceSpy.confirm.and.returnValue(of(confirmed));

    snackBarActionSubjects = [];
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    snackBarSpy.open.and.callFake(() => {
      const action$ = new Subject<void>();
      snackBarActionSubjects.push(action$);
      return { onAction: () => action$.asObservable() } as unknown as MatSnackBarRef<TextOnlySnackBar>;
    });

    TestBed.configureTestingModule({
      declarations: [AdminBansComponent],
      providers: [
        { provide: BanService, useValue: banServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogServiceSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
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

  it('addBan defaults the expiry to 7 days, not Permanent (S5-03)', () => {
    configure();
    component.newBan.bannedKeycloakId = 'user-9';
    banServiceSpy.listBans.calls.reset();

    component.addBan();

    expect(banServiceSpy.createBan).toHaveBeenCalledTimes(1);
    const payload = banServiceSpy.createBan.calls.mostRecent().args[0];
    expect(payload.bannedKeycloakId).toBe('user-9');
    expect(payload.expiresAt).not.toBeNull();
    const days = (new Date(payload.expiresAt as string).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeCloseTo(7, 0);
    expect(banServiceSpy.listBans).toHaveBeenCalled();
  });

  it('addBan sends expiresAt: null only when Permanent is explicitly chosen (S5-03)', () => {
    configure();
    component.newBan.bannedKeycloakId = 'user-9';
    component.newBanExpirySeconds = null;

    component.addBan();

    expect(banServiceSpy.createBan).toHaveBeenCalledWith(jasmine.objectContaining({ expiresAt: null }));
  });

  it('formatRelativeExpiry shows "Never" for a null value and a relative phrase otherwise (S5-18)', () => {
    configure();
    expect(component.formatRelativeExpiry(null)).toBe('Never');

    const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect(component.formatRelativeExpiry(inTwoDays)).toBe('in 2 days');

    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    expect(component.formatRelativeExpiry(oneHourAgo)).toBe('1 hour ago');
  });

  it('addBan surfaces the server\'s own error message, the way addIpBan already does (S5-09)', () => {
    configure();
    banServiceSpy.createBan.and.returnValue(throwError(() => ({ error: { message: 'That subject is already banned' } })));
    component.newBan.bannedKeycloakId = 'user-9';

    component.addBan();

    expect(snackBarSpy.open).toHaveBeenCalledWith('That subject is already banned', 'Dismiss', jasmine.any(Object));
    expect(component.submitting).toBeFalse();
  });

  it('addBan falls back to a generic message when the server sends none (S5-09)', () => {
    configure();
    banServiceSpy.createBan.and.returnValue(throwError(() => ({})));
    component.newBan.bannedKeycloakId = 'user-9';

    component.addBan();

    expect(snackBarSpy.open).toHaveBeenCalledWith('Failed to create ban', 'Dismiss', jasmine.any(Object));
  });

  describe('removeBan (S5-02)', () => {
    it('confirms, naming the target, before removing', () => {
      configure();

      component.removeBan(activeBan);

      expect(confirmDialogServiceSpy.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({ message: jasmine.stringMatching('user-9'), destructive: true })
      );
      expect(banServiceSpy.removeBan).toHaveBeenCalledWith('ban-1');
    });

    it('never calls the service when the confirmation is cancelled', () => {
      configure(false);

      component.removeBan(activeBan);

      expect(banServiceSpy.removeBan).not.toHaveBeenCalled();
    });

    it('offers Undo, which restores the same ban', () => {
      configure();
      banServiceSpy.listBans.calls.reset();

      component.removeBan(activeBan);

      expect(snackBarSpy.open).toHaveBeenCalledWith('Ban removed', 'Undo', jasmine.any(Object));
      banServiceSpy.createBan.calls.reset();

      snackBarActionSubjects[0].next();

      expect(banServiceSpy.createBan).toHaveBeenCalledWith({
        bannedKeycloakId: 'user-9',
        reason: 'flood',
        expiresAt: null,
      });
    });
  });

  describe('removeIpBan (S5-02)', () => {
    it('confirms, naming the target, before removing', () => {
      configure();

      component.removeIpBan(ipBan);

      expect(confirmDialogServiceSpy.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({ message: jasmine.stringMatching('203.0.113.5/32'), destructive: true })
      );
    });

    it('never calls the service when the confirmation is cancelled', () => {
      configure(false);

      component.removeIpBan(ipBan);

      expect(banServiceSpy.removeIpBan).not.toHaveBeenCalled();
    });

    it('offers Undo, which restores the same IP ban', () => {
      configure();

      component.removeIpBan(ipBan);

      snackBarActionSubjects[0].next();

      expect(banServiceSpy.createIpBan).toHaveBeenCalledWith({
        cidr: '203.0.113.5/32',
        reason: 'flood',
        expiresAt: '2026-01-02T00:00:00Z',
      });
    });
  });

  describe('CIDR field error display (S5-04)', () => {
    it('onIpCidrChange sets the error for a malformed, non-empty value (not just on submit)', () => {
      configure();
      component.newIpBan.cidr = '999.1.1.1';

      component.onIpCidrChange();

      expect(component.ipCidrError).toContain('IPv4');
      expect(component.ipCidrErrorStateMatcher.isErrorState()).toBeTrue();
    });

    it('onIpCidrChange clears the error once the value becomes valid', () => {
      configure();
      component.newIpBan.cidr = '999.1.1.1';
      component.onIpCidrChange();

      component.newIpBan.cidr = '203.0.113.5';
      component.onIpCidrChange();

      expect(component.ipCidrError).toBeNull();
      expect(component.ipCidrErrorStateMatcher.isErrorState()).toBeFalse();
    });

    it('onIpCidrBlur validates an empty value too (required)', () => {
      configure();
      component.newIpBan.cidr = '';

      component.onIpCidrBlur();

      expect(component.ipCidrError).toBeTruthy();
    });
  });

  describe('target-specific aria-labels and moderator-safe rendering (S5-02, S5-19)', () => {
    it('names the banned subject and the banned CIDR on their remove buttons', () => {
      configure();
      component.bans = [activeBan];
      component.loading = false;
      component.ipBans = [ipBan];
      component.ipBansLoading = false;
      fixture.detectChanges();

      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('[aria-label="Remove ban on user-9"]')).not.toBeNull();
      expect(root.querySelector('[aria-label="Remove IP ban on 203.0.113.5/32"]')).not.toBeNull();
    });

    it('renders no link to /admin/usage or /admin/taxonomy (a moderator sees nothing they cannot use, S5-19)', () => {
      configure();
      const root: HTMLElement = fixture.nativeElement;
      const hrefs = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? a.getAttribute('routerLink'));
      expect(hrefs.some((href) => href?.includes('/admin/usage'))).toBeFalse();
      expect(hrefs.some((href) => href?.includes('/admin/taxonomy'))).toBeFalse();
    });
  });
});
