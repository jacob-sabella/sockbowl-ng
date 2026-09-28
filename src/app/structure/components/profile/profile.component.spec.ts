import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { ProfileComponent } from './profile.component';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/auth/auth.service';
import { User, UserStatsResponse, UserGameHistoryResponse } from '../../../core/models/user-models';

describe('ProfileComponent', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const user: User = {
    id: 'u1',
    keycloakId: 'kc1',
    email: 'player@example.com',
    name: 'Test Player',
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: '2026-09-01T00:00:00Z',
  };

  const stats: UserStatsResponse = {
    id: 's1',
    userId: 'u1',
    totalGames: 10,
    totalWins: 4,
    totalBuzzes: 40,
    correctBuzzes: 30,
    updatedAt: '2026-09-01T00:00:00Z',
  };

  function historyPage(overrides: Partial<UserGameHistoryResponse> = {}): UserGameHistoryResponse {
    return {
      content: [
        {
          id: 'g1',
          userId: 'u1',
          gameSessionId: 'session-abc12345',
          playerSessionId: 'ps1',
          joinedAt: '2026-09-10T12:00:00Z',
          finalScore: 220,
          teamName: 'The Buzzwords',
        },
        {
          id: 'g2',
          userId: 'u1',
          gameSessionId: 'session-def67890',
          playerSessionId: 'ps2',
          joinedAt: '2026-09-11T12:00:00Z',
          finalScore: null,
          teamName: null,
        },
      ],
      totalPages: 1,
      totalElements: 2,
      size: 10,
      number: 0,
      ...overrides,
    };
  }

  function setUp(): void {
    TestBed.configureTestingModule({
      declarations: [ProfileComponent],
      providers: [
        { provide: UserService, useValue: userServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: Router, useValue: { url: '/profile' } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(ProfileComponent);
  }

  beforeEach(() => {
    userServiceSpy = jasmine.createSpyObj('UserService', ['getCurrentUser', 'getUserStats', 'getUserHistory']);
    authServiceSpy = jasmine.createSpyObj('AuthService', ['login']);
  });

  it('shows a loading state until user data resolves', () => {
    userServiceSpy.getCurrentUser.and.returnValue(new Subject());
    userServiceSpy.getUserStats.and.returnValue(new Subject());
    userServiceSpy.getUserHistory.and.returnValue(new Subject());
    setUp();

    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.loading-container')).not.toBeNull();
    expect(el.querySelector('.profile-content')).toBeNull();
    // S6-10: axe's aria-progressbar-name needs an accessible name on the spinner.
    expect(el.querySelector('mat-spinner')?.getAttribute('aria-label')).toBe('Loading profile');
  });

  it('renders game history rows with team, score, date and status — no raw game id', () => {
    userServiceSpy.getCurrentUser.and.returnValue(of(user));
    userServiceSpy.getUserStats.and.returnValue(of(stats));
    userServiceSpy.getUserHistory.and.returnValue(of(historyPage()));
    setUp();

    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const rows = el.querySelectorAll('.history-row');
    expect(rows.length).toBe(2);

    const text = el.textContent || '';
    expect(text).toContain('The Buzzwords');
    expect(text).toContain('220 pts');
    expect(text).toContain('Completed');
    expect(text).toContain('In Progress');
    expect(text).not.toContain('Game: session-');
  });

  it('shows the empty state when there is no game history', () => {
    userServiceSpy.getCurrentUser.and.returnValue(of(user));
    userServiceSpy.getUserStats.and.returnValue(of(stats));
    userServiceSpy.getUserHistory.and.returnValue(of(historyPage({ content: [], totalElements: 0 })));
    setUp();

    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.no-history')).not.toBeNull();
    expect(el.querySelectorAll('.history-row').length).toBe(0);
  });

  it('shows a retryable error state when the data load fails', () => {
    userServiceSpy.getCurrentUser.and.returnValue(of(user));
    userServiceSpy.getUserStats.and.returnValue(of(stats));
    userServiceSpy.getUserHistory.and.returnValue(throwError(() => new Error('network down')));
    setUp();

    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.error-container')).not.toBeNull();
    expect(el.querySelector('.profile-content')).toBeNull();
    expect(el.querySelector('button[color="primary"]')?.textContent).toContain('Retry');
  });

  describe('distinct error copy by class (S6-10)', () => {
    function failWith(status: number): void {
      userServiceSpy.getCurrentUser.and.returnValue(of(user));
      userServiceSpy.getUserStats.and.returnValue(of(stats));
      userServiceSpy.getUserHistory.and.returnValue(
        throwError(() => new HttpErrorResponse({ status }))
      );
      setUp();
      fixture.detectChanges();
    }

    it('offline (status 0) says it cannot reach Sockbowl, with Retry', () => {
      failWith(0);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.error-container')?.textContent).toContain("Can't reach Sockbowl");
      expect(el.querySelector('button[color="primary"]')?.textContent).toContain('Retry');
    });

    it('401 says the session ended and offers Sign In, which calls AuthService.login', () => {
      failWith(401);
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.error-container')?.textContent).toContain('Signed out');
      const button = el.querySelector<HTMLButtonElement>('button[color="primary"]');
      expect(button?.textContent).toContain('Sign In');

      button?.click();
      expect(authServiceSpy.login).toHaveBeenCalledWith('/profile');
    });

    it('403 says the user lacks permission', () => {
      failWith(403);
      expect(fixture.nativeElement.querySelector('.error-container')?.textContent)
        .toContain("don't have permission");
    });

    it('500 gives a server-side message distinct from the network and permission copy', () => {
      failWith(500);
      const text = fixture.nativeElement.querySelector('.error-container')?.textContent;
      expect(text).toContain('Something went wrong');
      expect(text).not.toContain("Can't reach Sockbowl");
    });
  });

  describe('a history page failure (S6-10)', () => {
    beforeEach(() => {
      userServiceSpy.getCurrentUser.and.returnValue(of(user));
      userServiceSpy.getUserStats.and.returnValue(of(stats));
      userServiceSpy.getUserHistory.and.returnValue(of(historyPage()));
      setUp();
      fixture.detectChanges();
    });

    it('errors only the history card, leaving the profile and stats cards up', () => {
      userServiceSpy.getUserHistory.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      fixture.componentInstance.loadPage(0);
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.error-container')).toBeNull();
      expect(el.querySelector('.profile-card')).not.toBeNull();
      expect(el.querySelector('.history-error')).not.toBeNull();
      expect(el.querySelector('.history-row')).toBeNull();

      // The copy names the game history specifically, not "profile" — a
      // history-only failure should never read like the whole page failed.
      const historyText = el.querySelector('.history-error')?.textContent ?? '';
      expect(historyText).toContain('game history');
      expect(historyText).not.toContain('profile');
    });

    it('retries just that page and clears the history error on success', () => {
      userServiceSpy.getUserHistory.and.returnValue(
        throwError(() => new HttpErrorResponse({ status: 500 }))
      );
      fixture.componentInstance.loadPage(0);
      fixture.detectChanges();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.history-error')).not.toBeNull();

      userServiceSpy.getUserHistory.and.returnValue(of(historyPage()));
      const retryButton: HTMLButtonElement | null = el.querySelector('.history-error button');
      retryButton?.click();
      fixture.detectChanges();

      expect(el.querySelector('.history-error')).toBeNull();
      expect(el.querySelectorAll('.history-row').length).toBe(2);
    });
  });
});
