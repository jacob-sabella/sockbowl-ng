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

  it('does not crash when the global usage fetch fails', () => {
    usageServiceSpy = jasmine.createSpyObj('UsageService', ['global']);
    usageServiceSpy.global.and.returnValue(throwError(() => new Error('down')));
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
    expect(() => fixture.detectChanges()).not.toThrow();
    expect(component.globalUsage).toBeNull();
  });
});
