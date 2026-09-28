import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AdminUsageComponent } from './admin-usage.component';
import { UsageService } from '../../../core/services/usage.service';
import { BanService } from '../../../core/services/ban.service';
import { EditQuotaDialogComponent } from './edit-quota-dialog/edit-quota-dialog.component';
import { BanUserDialogComponent } from './ban-user-dialog/ban-user-dialog.component';
import { UserUsageSummary, UsagePage, UserUsageDetail } from '../../../core/models/usage-models';

describe('AdminUsageComponent', () => {
  let fixture: ComponentFixture<AdminUsageComponent>;
  let component: AdminUsageComponent;
  let usageServiceSpy: jasmine.SpyObj<UsageService>;
  let banServiceSpy: jasmine.SpyObj<BanService>;
  let dialogSpy: jasmine.SpyObj<MatDialog>;

  const bannedRow: UserUsageSummary = {
    keycloakId: 'user-1',
    username: 'jane',
    displayName: 'Jane Doe',
    tier: 'AUTHOR',
    lastSeenAt: '2026-01-01T00:00:00Z',
    banned: true,
    activeSessions: 1,
    packetsOwned: null,
    counters: [
      { metric: 'ai.generations', used: 5, limit: 20, kind: 'daily', resetsAt: '2026-01-02T00:00:00Z', overridden: false },
      { metric: 'packets-owned', used: 2, limit: -1, kind: 'owned', resetsAt: null, overridden: true },
    ],
    recentRejections: 3,
  };

  const page: UsagePage = {
    content: [bannedRow],
    totalElements: 1,
    totalPages: 1,
    size: 20,
    number: 0,
  };

  const detail: UserUsageDetail = {
    ...bannedRow,
    lastIps: ['203.0.113.5'],
    overrides: { 'packets-owned': -1 },
    events: [],
    hostedSessionIds: [],
  };

  function configure(): void {
    usageServiceSpy = jasmine.createSpyObj('UsageService', [
      'list', 'detail', 'global', 'events', 'setQuotaOverride', 'resetUsage',
    ]);
    usageServiceSpy.list.and.returnValue(of(page));
    usageServiceSpy.detail.and.returnValue(of(detail));
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 10, limit: 200, resetsAt: null }, activeHostedSessions: 2, topGuestIps: [], rejectionsLastHour: 0 })
    );
    usageServiceSpy.events.and.returnValue(of([]));
    usageServiceSpy.setQuotaOverride.and.returnValue(of(undefined));
    usageServiceSpy.resetUsage.and.returnValue(of(undefined));

    banServiceSpy = jasmine.createSpyObj('BanService', ['createBan', 'createIpBan']);
    banServiceSpy.createBan.and.returnValue(of({} as any));
    banServiceSpy.createIpBan.and.returnValue(of({} as any));

    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      imports: [AdminUsageComponent],
      providers: [
        { provide: UsageService, useValue: usageServiceSpy },
        { provide: BanService, useValue: banServiceSpy },
        { provide: MatDialog, useValue: dialogSpy },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    });

    fixture = TestBed.createComponent(AdminUsageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('loads the page, the global card, and the events panel on init', () => {
    configure();
    expect(usageServiceSpy.list).toHaveBeenCalledWith(0, 20, undefined, 'lastSeen');
    expect(usageServiceSpy.global).toHaveBeenCalled();
    expect(usageServiceSpy.events).toHaveBeenCalledWith(100);
    expect(component.rows).toEqual([bannedRow]);
  });

  it('shows "—" for packets when questions could not be reached (packetsOwned null)', () => {
    configure();
    expect(component.packetsDisplay(bannedRow)).toBe('—');
  });

  it('shows a real number once packets are known', () => {
    configure();
    expect(component.packetsDisplay({ ...bannedRow, packetsOwned: 7 })).toBe('7');
  });

  it('renders meters as used/limit and ∞ for an unlimited (-1) counter', () => {
    configure();
    const daily = bannedRow.counters[0];
    const unlimited = bannedRow.counters[1];

    expect(component.isUnlimited(daily)).toBeFalse();
    expect(component.meterPercent(daily)).toBe(25);
    expect(component.isUnlimited(unlimited)).toBeTrue();
  });

  it('marks the banned row (via the `banned` flag consumed by the template chip)', () => {
    configure();
    expect(component.rows[0].banned).toBeTrue();
  });

  it('flags an overridden counter (consumed by the template\'s override badge)', () => {
    configure();
    expect(bannedRow.counters[1].overridden).toBeTrue();
  });

  it('expanding a row fetches and shows its detail', () => {
    configure();
    component.toggleDetail(bannedRow);
    expect(usageServiceSpy.detail).toHaveBeenCalledWith('user-1');
    expect(component.detail).toEqual(detail);
    expect(component.expandedSub).toBe('user-1');
  });

  it('collapses an already-expanded row', () => {
    configure();
    component.toggleDetail(bannedRow);
    component.toggleDetail(bannedRow);
    expect(component.expandedSub).toBeNull();
    expect(component.detail).toBeNull();
  });

  // NG-V1-04: A's request goes out first but its response arrives last,
  // after B's -- a classic slow-first-request race. A's stale response must
  // never overwrite B's, which is the row still actually expanded.
  it('ignores a stale detail response for a row that is no longer expanded', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', [
      'list', 'detail', 'global', 'events', 'setQuotaOverride', 'resetUsage',
    ]);
    usageServiceSpy.list.and.returnValue(of(page));
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 10, limit: 200, resetsAt: null }, activeHostedSessions: 2, topGuestIps: [], rejectionsLastHour: 0 })
    );
    usageServiceSpy.events.and.returnValue(of([]));
    const detailA: UserUsageDetail = { ...detail, keycloakId: 'user-1' };
    const detailB: UserUsageDetail = { ...detail, keycloakId: 'user-2' };
    const subA = new Subject<UserUsageDetail>();
    const subB = new Subject<UserUsageDetail>();
    usageServiceSpy.detail.and.callFake((sub: string) => (sub === 'user-1' ? subA : subB).asObservable());
    banServiceSpy = jasmine.createSpyObj('BanService', ['createBan', 'createIpBan']);
    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      imports: [AdminUsageComponent],
      providers: [
        { provide: UsageService, useValue: usageServiceSpy },
        { provide: BanService, useValue: banServiceSpy },
        { provide: MatDialog, useValue: dialogSpy },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    });
    fixture = TestBed.createComponent(AdminUsageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const rowB: UserUsageSummary = { ...bannedRow, keycloakId: 'user-2', username: 'bob' };
    component.toggleDetail(bannedRow); // expands A ('user-1'), fires its request
    component.toggleDetail(rowB);      // switches to B ('user-2') before A resolves

    subB.next(detailB); // B's response arrives first
    subA.next(detailA); // A's response arrives late, after the switch to B

    expect(component.expandedSub).toBe('user-2');
    expect(component.detail).toEqual(detailB);
  });

  it('reset calls the service with the metric and refreshes the list', () => {
    configure();
    usageServiceSpy.list.calls.reset();

    component.resetUsage(bannedRow, 'ai.generations');

    expect(usageServiceSpy.resetUsage).toHaveBeenCalledWith('user-1', 'ai.generations');
    expect(usageServiceSpy.list).toHaveBeenCalled();
  });

  it('reset-all (no metric) refreshes an expanded row\'s detail too', () => {
    configure();
    component.toggleDetail(bannedRow);
    usageServiceSpy.detail.calls.reset();

    component.resetUsage(bannedRow);

    expect(usageServiceSpy.resetUsage).toHaveBeenCalledWith('user-1', undefined);
    expect(usageServiceSpy.detail).toHaveBeenCalledWith('user-1');
  });

  it('opens the edit-quota dialog and, on save, calls setQuotaOverride', () => {
    configure();
    dialogSpy.open.and.returnValue({ afterClosed: () => of({ limit: 30 }) } as any);

    component.editQuota(bannedRow, bannedRow.counters[0]);

    expect(dialogSpy.open).toHaveBeenCalledWith(
      EditQuotaDialogComponent,
      jasmine.objectContaining({ data: { metric: 'ai.generations', currentLimit: 20, overridden: false } })
    );
    expect(usageServiceSpy.setQuotaOverride).toHaveBeenCalledWith('user-1', 'ai.generations', 30);
  });

  it('the quota dialog\'s "role default" sends null, not a number', () => {
    configure();
    dialogSpy.open.and.returnValue({ afterClosed: () => of({ limit: null }) } as any);

    component.editQuota(bannedRow, bannedRow.counters[1]);

    expect(usageServiceSpy.setQuotaOverride).toHaveBeenCalledWith('user-1', 'packets-owned', null);
  });

  it('a cancelled quota dialog (undefined result) never calls the service', () => {
    configure();
    dialogSpy.open.and.returnValue({ afterClosed: () => of(undefined) } as any);

    component.editQuota(bannedRow, bannedRow.counters[0]);

    expect(usageServiceSpy.setQuotaOverride).not.toHaveBeenCalled();
  });

  it('Ban opens the ban flow and, on confirm, calls BanService.createBan', () => {
    configure();
    dialogSpy.open.and.returnValue({
      afterClosed: () => of({ bannedKeycloakId: 'user-1', reason: 'spam', expiresAt: null }),
    } as any);

    component.banUser(bannedRow);

    expect(dialogSpy.open).toHaveBeenCalledWith(
      BanUserDialogComponent,
      jasmine.objectContaining({ data: { keycloakId: 'user-1', displayName: 'Jane Doe' } })
    );
    expect(banServiceSpy.createBan).toHaveBeenCalledWith({
      bannedKeycloakId: 'user-1',
      reason: 'spam',
      expiresAt: null,
    });
  });

  it('a cancelled ban dialog never calls the service', () => {
    configure();
    dialogSpy.open.and.returnValue({ afterClosed: () => of(undefined) } as any);

    component.banUser(bannedRow);

    expect(banServiceSpy.createBan).not.toHaveBeenCalled();
  });

  it('banIp opens the IP-ban dialog and, on confirm, calls BanService.createIpBan', () => {
    configure();
    dialogSpy.open.and.returnValue({
      afterClosed: () => of({ cidr: '203.0.113.5/32', reason: undefined, ttlSeconds: 3600 }),
    } as any);

    component.banIp('203.0.113.5');

    expect(banServiceSpy.createIpBan).toHaveBeenCalledWith({ cidr: '203.0.113.5/32', reason: undefined, ttlSeconds: 3600 });
  });

  it('surfaces a global-usage fetch failure gracefully (no crash, global stays null)', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', [
      'list', 'detail', 'global', 'events', 'setQuotaOverride', 'resetUsage',
    ]);
    usageServiceSpy.list.and.returnValue(of(page));
    usageServiceSpy.global.and.returnValue(throwError(() => new Error('down')));
    usageServiceSpy.events.and.returnValue(of([]));
    banServiceSpy = jasmine.createSpyObj('BanService', ['createBan', 'createIpBan']);
    dialogSpy = jasmine.createSpyObj('MatDialog', ['open']);

    TestBed.configureTestingModule({
      imports: [AdminUsageComponent],
      providers: [
        { provide: UsageService, useValue: usageServiceSpy },
        { provide: BanService, useValue: banServiceSpy },
        { provide: MatDialog, useValue: dialogSpy },
        { provide: MatSnackBar, useValue: jasmine.createSpyObj('MatSnackBar', ['open']) },
      ],
    });
    fixture = TestBed.createComponent(AdminUsageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.global).toBeNull();
    expect(component.globalLoading).toBeFalse();
  });

  it('onSearch resets to the first page and re-lists with the query', () => {
    configure();
    component.pageIndex = 3;
    component.searchQuery = '  jane  ';
    usageServiceSpy.list.calls.reset();

    component.onSearch();

    expect(component.pageIndex).toBe(0);
    expect(usageServiceSpy.list).toHaveBeenCalledWith(0, 20, 'jane', 'lastSeen');
  });

  it('onPage updates the page index/size and re-lists', () => {
    configure();
    usageServiceSpy.list.calls.reset();

    component.onPage({ pageIndex: 2, pageSize: 50, length: 100 } as any);

    expect(component.pageIndex).toBe(2);
    expect(component.pageSize).toBe(50);
    expect(usageServiceSpy.list).toHaveBeenCalledWith(2, 50, undefined, 'lastSeen');
  });

  // NG-V1-01: a 429 or a 403 banned/ip_banned rejection on one of THIS
  // component's own admin actions is already surfaced by the global
  // RateLimitInterceptor (plan §2.9); these handlers must not show a second,
  // generic "Failed to..." snackbar for the same rejection.
  //
  // `AdminUsageComponent` is standalone and imports `MatSnackBarModule`
  // directly, and that module's own `@NgModule` `providers: [MatSnackBar]`
  // (see its compiled declaration) gives every component that imports it a
  // fresh `MatSnackBar` scoped to that component's own injector -- so a
  // `{ provide: MatSnackBar, useValue: ... }` override registered at the
  // TestBed root (as `configure()` does, and as the sibling
  // `packet-search.component.spec.ts` relies on for its own, *non*-standalone
  // component) is shadowed and never reaches `this.snackBar` here. Spying
  // directly on the component's own instance sidesteps that shadowing
  // instead of fighting it.
  describe('NG-V1-01 isLimitHandled: no duplicate snackbar for 429/403-ban', () => {
    function spyOnOwnSnackBar(): jasmine.Spy {
      return spyOn((component as any).snackBar, 'open');
    }

    it('editQuota: no "Failed to update quota" snackbar on a classified 429', () => {
      configure();
      dialogSpy.open.and.returnValue({ afterClosed: () => of({ limit: 30 }) } as any);
      usageServiceSpy.setQuotaOverride.and.returnValue(
        throwError(() => ({ status: 429, error: { error: 'rate_limited' } }))
      );
      const open = spyOnOwnSnackBar();

      component.editQuota(bannedRow, bannedRow.counters[0]);

      expect(open).not.toHaveBeenCalled();
    });

    it('resetUsage: no "Failed to reset usage" snackbar on a 403 ip_banned', () => {
      configure();
      usageServiceSpy.resetUsage.and.returnValue(
        throwError(() => ({ status: 403, error: { error: 'ip_banned' } }))
      );
      const open = spyOnOwnSnackBar();

      component.resetUsage(bannedRow, 'ai.generations');

      expect(open).not.toHaveBeenCalled();
    });

    it('banUser: no "Failed to ban user" snackbar on a 403 banned', () => {
      configure();
      dialogSpy.open.and.returnValue({
        afterClosed: () => of({ bannedKeycloakId: 'user-1', reason: 'x', expiresAt: null }),
      } as any);
      banServiceSpy.createBan.and.returnValue(throwError(() => ({ status: 403, error: { error: 'banned' } })));
      const open = spyOnOwnSnackBar();

      component.banUser(bannedRow);

      expect(open).not.toHaveBeenCalled();
    });

    it('banIp: no "Failed to ban IP" snackbar on a classified 429', () => {
      configure();
      dialogSpy.open.and.returnValue({
        afterClosed: () => of({ cidr: '203.0.113.5/32', reason: undefined, ttlSeconds: 3600 }),
      } as any);
      banServiceSpy.createIpBan.and.returnValue(
        throwError(() => ({ status: 429, error: { error: 'rate_limited' } }))
      );
      const open = spyOnOwnSnackBar();

      component.banIp('203.0.113.5');

      expect(open).not.toHaveBeenCalled();
    });

    it('still shows "Failed to update quota" for an unrelated error (e.g. 500)', () => {
      configure();
      dialogSpy.open.and.returnValue({ afterClosed: () => of({ limit: 30 }) } as any);
      usageServiceSpy.setQuotaOverride.and.returnValue(throwError(() => ({ status: 500 })));
      const open = spyOnOwnSnackBar();

      component.editQuota(bannedRow, bannedRow.counters[0]);

      expect(open).toHaveBeenCalledWith('Failed to update quota', 'Dismiss', jasmine.anything());
    });

    // FIX3-NG: a plain 429/503 with no classifiable body is NOT something
    // RateLimitInterceptor showed a snackbar for (its handle() bails out
    // when the body's `error` field doesn't classify), so isLimitHandled
    // must say false and this component's own fallback message must still
    // show -- otherwise the rejection is swallowed with nothing shown at all.
    it('still shows "Failed to update quota" for a plain 429 with no classifiable body', () => {
      configure();
      dialogSpy.open.and.returnValue({ afterClosed: () => of({ limit: 30 }) } as any);
      usageServiceSpy.setQuotaOverride.and.returnValue(throwError(() => ({ status: 429 })));
      const open = spyOnOwnSnackBar();

      component.editQuota(bannedRow, bannedRow.counters[0]);

      expect(open).toHaveBeenCalledWith('Failed to update quota', 'Dismiss', jasmine.anything());
    });
  });
});
