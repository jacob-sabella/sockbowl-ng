import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { Difficulty, PacketFilter, PacketSummary } from '../../models/packet-authoring.models';
import { AuthService } from '../../../core/auth/auth.service';
import { describeGraphqlError } from '../../../core/graphql/graphql-errors';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { PacketImportDialogComponent } from '../packet-import-dialog/packet-import-dialog.component';

/**
 * Packet list / landing page for the packet builder feature (M3 plan 3.3.4,
 * PB-19). Backed by the paginated, policy-filtered {@link PacketSummary}
 * projection rather than the deprecated full-content `getAllPackets`, so
 * this page never receives answer text for packets the caller can't fully
 * read.
 */
@Component({
  selector: 'app-packet-list',
  templateUrl: './packet-list.component.html',
  styleUrls: ['./packet-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class PacketListComponent implements OnInit {
  private sockbowlQuestionsService = inject(SockbowlQuestionsService);
  private packetAuthoring = inject(PacketAuthoringService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private confirmDialog = inject(ConfirmDialogService);
  auth = inject(AuthService);

  packets: PacketSummary[] = [];
  difficulties: Difficulty[] = [];
  loading = true;

  total = 0;
  pageIndex = 0;
  pageSize = 25;
  readonly pageSizeOptions = [10, 25, 50, 100];

  searchQuery = '';
  showMineOnly = false;
  selectedDifficultyId: string | null = null;

  showCreateForm = false;
  creating = false;
  newPacketName = '';
  newPacketDifficultyId: string | null = null;

  /** ids currently mid-action (duplicate/export/delete), so buttons can disable per row. */
  busyIds = new Set<string>();

  private searchQuery$ = new Subject<string>();

  ngOnInit(): void {
    this.packetAuthoring.getAllDifficulties().subscribe({
      next: (difficulties) => (this.difficulties = difficulties),
      error: () => {
        // Non-fatal: the difficulty filter is simply empty if this fails.
      }
    });

    this.searchQuery$
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => {
        this.pageIndex = 0;
        this.load();
      });

    this.load();
  }

  private buildFilter(): PacketFilter {
    const filter: PacketFilter = {};
    if (this.showMineOnly) {
      filter.mine = true;
    }
    const name = this.searchQuery.trim();
    if (name) {
      filter.nameContains = name;
    }
    if (this.selectedDifficultyId) {
      filter.difficultyId = this.selectedDifficultyId;
    }
    return filter;
  }

  load(): void {
    this.loading = true;
    this.sockbowlQuestionsService.listPackets(this.buildFilter(), this.pageIndex, this.pageSize).subscribe({
      next: (page) => {
        this.packets = page.items;
        this.total = page.total;
        this.pageIndex = page.page;
        this.pageSize = page.size;
        this.loading = false;
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
        this.loading = false;
      }
    });
  }

  onSearchInput(value: string): void {
    this.searchQuery$.next(value);
  }

  onMineToggle(): void {
    this.pageIndex = 0;
    this.load();
  }

  onDifficultyFilterChange(): void {
    this.pageIndex = 0;
    this.load();
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.load();
  }

  /**
   * Whether the current user may edit/delete/export/clone this packet: only
   * a caller who can read it in full (the owner, or `packet:manage-any`) can
   * do any of those, mirroring the server's `PacketReadPolicy.canReadFull`
   * and `PacketAuthorizationService.canManage` (D3 — ownerless packets are
   * manage-any only, no grandfather rule).
   */
  canManage(packet: PacketSummary): boolean {
    const userId = this.auth.getCurrentUserId();
    return this.auth.hasPermission('packet:manage-any')
      || (!!userId && !!packet.owner && packet.owner.id === userId);
  }

  toggleCreateForm(): void {
    this.showCreateForm = !this.showCreateForm;
    if (!this.showCreateForm) {
      this.newPacketName = '';
      this.newPacketDifficultyId = null;
    }
  }

  createPacket(): void {
    const name = this.newPacketName.trim();
    if (!name) {
      this.snackBar.open('A packet name is required', 'Dismiss', { duration: 3000 });
      return;
    }

    this.creating = true;
    this.packetAuthoring.createPacket({ name, difficultyId: this.newPacketDifficultyId }).subscribe({
      next: (id) => {
        this.creating = false;
        this.snackBar.open('Packet created', 'Dismiss', { duration: 2500 });
        this.router.navigate(['/packets', id, 'edit']);
      },
      error: (err) => {
        this.creating = false;
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  openImportDialog(): void {
    this.dialog.open(PacketImportDialogComponent, {
      width: 'min(720px, 95vw)',
      maxHeight: '90vh',
      autoFocus: false
    });
  }

  duplicatePacket(packet: PacketSummary): void {
    if (this.busyIds.has(packet.id)) {
      return;
    }
    this.busyIds.add(packet.id);
    this.packetAuthoring.clonePacket(packet.id).subscribe({
      next: (newId) => {
        this.busyIds.delete(packet.id);
        this.snackBar.open('Packet duplicated', 'Dismiss', { duration: 2500 });
        this.router.navigate(['/packets', newId, 'edit']);
      },
      error: (err) => {
        this.busyIds.delete(packet.id);
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  exportPacket(packet: PacketSummary): void {
    if (this.busyIds.has(packet.id)) {
      return;
    }
    this.busyIds.add(packet.id);
    this.sockbowlQuestionsService.exportPacket(packet.id).subscribe({
      next: (text) => {
        this.busyIds.delete(packet.id);
        downloadTextFile(`${slugify(packet.name)}.txt`, text);
      },
      error: (err) => {
        this.busyIds.delete(packet.id);
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  /**
   * Play test (PB-15): hand off to the game lobby, same as the builder's
   * button (N3). NG-V1-05: don't pre-set the pending packet here.
   * GameSessionComponent sets it from the `packetId` query param this
   * navigation carries, so a second, earlier write is redundant and is
   * exactly what goes stale if navigation is cancelled or the solo game
   * fails to start.
   */
  playTest(packet: PacketSummary): void {
    this.router.navigate(['/game-session'], { queryParams: { mode: 'single', packetId: packet.id } });
  }

  deletePacket(packet: PacketSummary): void {
    this.confirmDialog
      .confirm({
        title: 'Delete packet',
        message: `Delete packet "${packet.name}"? This cannot be undone.`,
        confirmText: 'Delete',
        destructive: true
      })
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.packetAuthoring.deletePacket(packet.id).subscribe({
          next: () => {
            this.snackBar.open('Packet deleted', 'Dismiss', { duration: 2500 });
            this.packets = this.packets.filter((p) => p.id !== packet.id);
            this.total = Math.max(0, this.total - 1);
          },
          error: (err) => {
            // INT1: describeGraphqlError returns '' for RATE_LIMITED/QUOTA_EXCEEDED/
            // BANNED, since GraphqlClientService's notifyLimit already shows the
            // canonical snackbar for those; don't show a second, empty one.
            const message = this.extractError(err);
            if (message) {
              this.snackBar.open(message, 'Dismiss', { duration: 4000 });
            }
          }
        });
      });
  }

  private extractError(err: unknown): string {
    return describeGraphqlError(err);
  }
}

/** Lowercase, hyphenated filename stem from a packet name, never empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'packet';
}

/** Triggers a browser download of `text` as a UTF-8 file named `filename`. */
function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
