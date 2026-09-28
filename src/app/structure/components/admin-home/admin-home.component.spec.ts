import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { AdminHomeComponent } from './admin-home.component';
import { AuthService } from '../../../core/auth/auth.service';
import { UsageService } from '../../../core/services/usage.service';

describe('AdminHomeComponent', () => {
  let fixture: ComponentFixture<AdminHomeComponent>;
  let component: AdminHomeComponent;
  let usageServiceSpy: jasmine.SpyObj<UsageService>;

  function configure(): void {
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);

    usageServiceSpy = jasmine.createSpyObj('UsageService', ['global']);
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 42, limit: 200, resetsAt: null }, activeHostedSessions: 3, topGuestIps: [], rejectionsLastHour: 0 })
    );

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AdminHomeComponent],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: UsageService, useValue: usageServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(AdminHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('links the Usage card to /admin/usage', () => {
    configure();
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[aria-label="Open usage and quotas"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe('/admin/usage');
  });

  it('shows the AI budget meter once global usage loads', () => {
    configure();
    expect(component.globalUsage?.aiServerKey.used).toBe(42);
    expect(component.globalUsage?.aiServerKey.limit).toBe(200);
    const label: HTMLElement = fixture.nativeElement.querySelector('.admin-home__ai-budget-label');
    expect(label?.textContent).toContain('42');
    expect(label?.textContent).toContain('200');
  });

  it('shows ∞ instead of a bar for an unlimited budget', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', ['global']);
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 5, limit: -1, resetsAt: null }, activeHostedSessions: 0, topGuestIps: [], rejectionsLastHour: 0 })
    );
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);
    TestBed.configureTestingModule({
      declarations: [AdminHomeComponent],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: UsageService, useValue: usageServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AdminHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const label: HTMLElement = fixture.nativeElement.querySelector('.admin-home__ai-budget-label');
    expect(label?.textContent).toContain('∞');
    expect(component.aiBudgetPercent()).toBe(0);
  });

  it('keeps the AI-budget slot with "unavailable" and a Retry, outside the card link, on a fetch failure (S5-06)', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', ['global']);
    usageServiceSpy.global.and.returnValue(throwError(() => new Error('down')));
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AdminHomeComponent],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: UsageService, useValue: usageServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AdminHomeComponent);
    component = fixture.componentInstance;
    expect(() => fixture.detectChanges()).not.toThrow();

    expect(component.globalUsage).toBeNull();
    expect(component.globalUsageError).toBeTrue();
    expect(component.globalUsageLoading).toBeFalse();
    const root: HTMLElement = fixture.nativeElement;
    const slot = root.querySelector('.admin-home__ai-budget-slot');
    expect(slot?.textContent).toContain('AI budget unavailable');
    // The Retry button must not be nested inside the card's own <a> (axe "nested-interactive").
    expect(root.querySelector('a.admin-home__card-link--inline button')).toBeNull();
  });

  it('Retry re-fetches global usage', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', ['global']);
    usageServiceSpy.global.and.returnValue(throwError(() => new Error('down')));
    const authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(true);
    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AdminHomeComponent],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: UsageService, useValue: usageServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    fixture = TestBed.createComponent(AdminHomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    usageServiceSpy.global.and.returnValue(
      of({ aiServerKey: { used: 1, limit: 10, resetsAt: null }, activeHostedSessions: 0, topGuestIps: [], rejectionsLastHour: 0 })
    );

    component.loadGlobalUsage();
    fixture.detectChanges();

    expect(component.globalUsageError).toBeFalse();
    expect(component.globalUsage?.aiServerKey.used).toBe(1);
  });
});

/**
 * FIX-N2 (M2): the Bans card follows user:ban. Merged forward into M4, where
 * the Usage card is no longer a "Coming soon" placeholder but a link
 * (M4-AD-02) shown to every admin regardless of user:ban.
 */
describe('AdminHomeComponent permissions (FIX-N2)', () => {
  let fixture: ComponentFixture<AdminHomeComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;

  function setUp(hasUserBan: boolean): void {
    authSpy.hasPermission.and.callFake((p: string) => p === 'user:ban' && hasUserBan);
    fixture.detectChanges();
  }

  function cardTitles(): (string | undefined)[] {
    const root: HTMLElement = fixture.nativeElement;
    return Array.from(root.querySelectorAll('.admin-home__card-title')).map(el => el.textContent?.trim());
  }

  beforeEach(() => {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(false);
    const usage = jasmine.createSpyObj<UsageService>('UsageService', ['global']);
    usage.global.and.returnValue(throwError(() => new Error('not needed here')));

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [AdminHomeComponent],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: UsageService, useValue: usage },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(AdminHomeComponent);
  });

  it('creates and shows the Admin title', () => {
    setUp(false);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.admin-home__title')?.textContent).toContain('Admin');
  });

  it('shows the Usage card regardless of user:ban', () => {
    setUp(false);
    expect(cardTitles()).toContain('Usage');
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label="Open usage and quotas"]')).not.toBeNull();
  });

  it('hides the Bans card for an admin without user:ban', () => {
    setUp(false);
    expect(cardTitles()).not.toContain('Bans');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[aria-label="Open ban management"]')).toBeNull();
  });

  it('shows a Bans link for an admin holding user:ban', () => {
    setUp(true);
    expect(cardTitles()).toContain('Bans');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[aria-label="Open ban management"]')).not.toBeNull();
  });

  it('hides the Taxonomy card for an admin without taxonomy:manage (S5-13)', () => {
    setUp(false);
    expect(cardTitles()).not.toContain('Taxonomy');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[aria-label="Open taxonomy"]')).toBeNull();
  });

  it('shows a Taxonomy link for an admin holding taxonomy:manage (S5-13)', () => {
    authSpy.hasPermission.and.callFake((p: string) => p === 'taxonomy:manage');
    fixture.detectChanges();
    expect(cardTitles()).toContain('Taxonomy');
    expect((fixture.nativeElement as HTMLElement).querySelector('a[aria-label="Open taxonomy"]')).not.toBeNull();
  });
});
