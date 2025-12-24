import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { UserService } from '../../../core/services/user.service';
import { Observable, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  User,
  UserStatsResponse,
  UserGameHistoryResponse,
  UserGameHistory
} from '../../../core/models/user-models';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss']
})
export class ProfileComponent implements OnInit {
  user$!: Observable<User>;
  stats$!: Observable<UserStatsResponse>;
  gameHistory: UserGameHistory[] = [];

  loading = true;
  error: string | null = null;

  // Pagination
  currentPage = 0;
  pageSize = 10;
  totalPages = 0;
  totalElements = 0;

  constructor(
    private authService: AuthService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    this.loadUserData();
  }

  loadUserData(): void {
    this.loading = true;
    this.error = null;

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
        this.error = 'Failed to load user data. Please try again.';
        this.loading = false;
      }
    });
  }

  loadPage(page: number): void {
    if (page < 0 || page >= this.totalPages) {
      return;
    }

    this.currentPage = page;
    this.userService.getUserHistory(this.currentPage, this.pageSize).subscribe({
      next: (data) => {
        this.gameHistory = data.content;
        this.totalPages = data.totalPages;
        this.totalElements = data.totalElements;
        this.currentPage = data.number;
      },
      error: (err) => {
        console.error('Error loading game history:', err);
        this.error = 'Failed to load game history.';
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
