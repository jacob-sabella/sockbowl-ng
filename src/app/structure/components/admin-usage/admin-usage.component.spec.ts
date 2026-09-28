import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { delay } from 'rxjs/operators';
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

  it('renders the table once a genuinely async HTTP response resolves, with no second manual detectChanges (OnPush, S5-01)', fakeAsync(() => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', [
      'list', 'detail', 'global', 'events', 'setQuotaOverride', 'resetUsage',
    ]);
    usageServiceSpy.list.and.returnValue(of(page).pipe(delay(1)));
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 10, limit: 200, resetsAt: null }, activeHostedSessions: 2, topGuestIps: [], rejectionsLastHour: 0 }).pipe(delay(1))
    );
    usageServiceSpy.events.and.returnValue(of([]).pipe(delay(1)));
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

    // Mirrors production: NgZone flushes an ApplicationRef tick once the
    // async HTTP call settles. No explicit fixture.detectChanges() is
    // called after this point, so the assertions below only pass if the
    // component notifies change detection itself (markForCheck/signals).
    fixture.autoDetectChanges(true);
    tick(1);

    expect(component.rows).toEqual([bannedRow]);
    expect(component.loading).toBeFalse();
    const text = (fixture.nativeElement as HTMLElement).textContent || '';
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('No users match.');
  }));

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
});
