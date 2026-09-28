import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';

import { ProfileComponent } from './profile.component';
import { UserService } from '../../../core/services/user.service';
import { AuthService } from '../../../core/auth/auth.service';
import { User, UserStatsResponse, UserGameHistoryResponse } from '../../../core/models/user-models';

describe('ProfileComponent', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let userServiceSpy: jasmine.SpyObj<UserService>;

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
        { provide: AuthService, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(ProfileComponent);
  }

  beforeEach(() => {
    userServiceSpy = jasmine.createSpyObj('UserService', ['getCurrentUser', 'getUserStats', 'getUserHistory']);
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
});
