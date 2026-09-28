import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../core/auth/auth.service';
import { UserService } from '../../../core/services/user.service';
import { Observable, forkJoin } from 'rxjs';
import {
  User,
  UserStatsResponse,
  UserGameHistory
} from '../../../core/models/user-models';

/**
 * A designed error state (S6-10), built surface-local because F1's
 * `shared/state/error-state` primitive doesn't exist yet in this branch
 * (handoff filed to F2). Shape mirrors that primitive's intended API
 * (icon, title, message, action) so swapping in the real component later is
 * a template change, not a rewrite.
 */
export interface ProfileErrorState {
  icon: string;
  title: string;
  message: string;
  primaryLabel: string;
  primaryAction: 'retry' | 'sign-in';
}

/**
 * Builds the designed state for one error class, with copy scoped to what
 * failed to load (S6-10: "your profile" for the whole page, "this page of
 * your game history" for a history-only failure) — `subject` is that phrase.
 */
function networkError(subject: string): ProfileErrorState {
  return {
    icon: 'wifi_off',
    title: "Can't reach Sockbowl",
    message: `Check your connection and try again to load ${subject}.`,
    primaryLabel: 'Retry',
    primaryAction: 'retry',
  };
}

function unauthorizedError(subject: string): ProfileErrorState {
  return {
    icon: 'lock',
    title: 'Signed out',
    message: `Your session ended. Sign in to see ${subject}.`,
    primaryLabel: 'Sign In',
    primaryAction: 'sign-in',
  };
}

function forbiddenError(subject: string): ProfileErrorState {
  return {
    icon: 'block',
    title: `Can't show ${subject}`,
    message: "You don't have permission to view this page.",
    primaryLabel: 'Retry',
    primaryAction: 'retry',
  };
}

function serverError(subject: string): ProfileErrorState {
  return {
    icon: 'report',
    title: 'Something went wrong',
    message: `The server had a problem loading ${subject}. Try again in a moment.`,
    primaryLabel: 'Retry',
    primaryAction: 'retry',
  };
}

function unknownError(subject: string): ProfileErrorState {
  return {
    icon: 'error',
    title: 'Failed to load',
    message: `Something went wrong loading ${subject}. Please try again.`,
    primaryLabel: 'Retry',
    primaryAction: 'retry',
  };
}

/** Classifies a load failure into a designed state with distinct copy per class (S6-10). */
export function describeProfileError(err: unknown, subject: string): ProfileErrorState {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return networkError(subject);
    }
    if (err.status === 401) {
      return unauthorizedError(subject);
    }
    if (err.status === 403) {
      return forbiddenError(subject);
    }
    if (err.status >= 500) {
      return serverError(subject);
    }
  }
  return unknownError(subject);
}

@Component({
    selector: 'app-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ProfileComponent implements OnInit {
  private authService = inject(AuthService);
  private userService = inject(UserService);
  private router = inject(Router);

  user$!: Observable<User>;
  stats$!: Observable<UserStatsResponse>;
  gameHistory: UserGameHistory[] = [];

  loading = true;
  /** Whole-page failure (initial load): user, stats and history all missing. */
  error: ProfileErrorState | null = null;
  /**
   * A later page of game history failed to load (S6-10): the user card and
   * stats stay up, only the history card shows its own error and retry.
   */
  historyError: ProfileErrorState | null = null;

  // Pagination
  currentPage = 0;
  pageSize = 10;
  totalPages = 0;
  totalElements = 0;

  ngOnInit(): void {
    this.loadUserData();
  }

  loadUserData(): void {
    this.loading = true;
    this.error = null;
    this.historyError = null;

    // Load user info and stats in parallel
    forkJoin({
      user: this.userService.getCurrentUser(),
      stats: this.userService.getUserStats(),
      history: this.userService.getUserHistory(this.currentPage, this.pageSize)
    }).subscribe({
      next: (data) => {
        this.user$ = new Observable(subscriber => {
          subscriber.next(data.user);
          subscriber.complete();
        });

        this.stats$ = new Observable(subscriber => {
          subscriber.next(data.stats);
          subscriber.complete();
        });

        this.gameHistory = data.history.content;
        this.totalPages = data.history.totalPages;
        this.totalElements = data.history.totalElements;
        this.currentPage = data.history.number;

        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading user data:', err);
        this.error = describeProfileError(err, 'your profile');
        this.loading = false;
      }
    });
  }

  /** The primary action on the whole-page error card: Retry, or Sign In for a 401. */
  handlePrimaryError(): void {
    if (this.error?.primaryAction === 'sign-in') {
      this.signIn();
      return;
    }
    this.loadUserData();
  }

  /** The primary action on the history card's own error: always a retry of that page. */
  retryHistory(): void {
    this.loadPage(this.currentPage);
  }

  signIn(): void {
    this.authService.login(this.router.url);
  }

  loadPage(page: number): void {
    if (page < 0 || page >= this.totalPages) {
      return;
    }

    this.currentPage = page;
    this.historyError = null;
    this.userService.getUserHistory(this.currentPage, this.pageSize).subscribe({
      next: (data) => {
        this.gameHistory = data.content;
        this.totalPages = data.totalPages;
        this.totalElements = data.totalElements;
        this.currentPage = data.number;
      },
      error: (err) => {
        console.error('Error loading game history:', err);
        this.historyError = describeProfileError(err, 'your game history');
      }
    });
  }

  get pages(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i);
  }

  calculateBuzzAccuracy(stats: UserStatsResponse): number {
    if (stats.totalBuzzes === 0) {
      return 0;
    }
    return (stats.correctBuzzes / stats.totalBuzzes) * 100;
  }

  calculateWinRate(stats: UserStatsResponse): number {
    if (stats.totalGames === 0) {
      return 0;
    }
    return (stats.totalWins / stats.totalGames) * 100;
  }

  formatDate(dateString: string): string {
    if (!dateString) {
      return 'Not available';
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Not available';
    }
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
