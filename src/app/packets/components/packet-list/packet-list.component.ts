import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { Packet } from '../../../game/models/sockbowl/packet-types.generated';
import { Difficulty } from '../../models/packet-authoring.models';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Packet list / landing page for the packet builder feature. Lists existing
 * packets (search or full list), supports creating a new packet inline, and
 * hands off to the builder for editing.
 */
@Component({
  selector: 'app-packet-list',
  templateUrl: './packet-list.component.html',
  styleUrls: ['./packet-list.component.scss'],
  standalone: false
})
export class PacketListComponent implements OnInit {
  packets: Packet[] = [];
  difficulties: Difficulty[] = [];
  loading = true;
  searching = false;

  searchQuery = '';
  showMineOnly = false;

  showCreateForm = false;
  creating = false;
  newPacketName = '';
  newPacketDifficultyId: string | null = null;

  constructor(
    private sockbowlQuestionsService: SockbowlQuestionsService,
    private packetAuthoring: PacketAuthoringService,
    private router: Router,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

  ngOnInit(): void {
    this.loading = true;
    forkJoin({
      packets: this.sockbowlQuestionsService.getAllPackets(),
      difficulties: this.packetAuthoring.getAllDifficulties()
    }).subscribe({
      next: ({ packets, difficulties }) => {
        this.packets = packets;
        this.difficulties = difficulties;
        this.loading = false;
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
        this.loading = false;
      }
    });
  }

  /** Client-side "my packets" filter over the already-fetched list. */
  get filteredPackets(): Packet[] {
    if (!this.showMineOnly) {
      return this.packets;
    }
    const userId = this.auth.getCurrentUserId();
    return this.packets.filter(p => p.owner?.id === userId);
  }

  /** Whether the current user may edit/delete this packet. */
  canManage(packet: Packet): boolean {
    return this.auth.isAdmin()
      || this.auth.hasPermission('packet:manage-any')
      || !packet.owner
      || packet.owner.id === this.auth.getCurrentUserId();
  }

  search(): void {
    const query = this.searchQuery.trim();
    this.searching = true;
    const search$ = query
      ? this.sockbowlQuestionsService.searchPacketsByName(query)
      : this.sockbowlQuestionsService.getAllPackets();

    search$.subscribe({
      next: (packets) => {
        this.packets = packets;
        this.searching = false;
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
        this.searching = false;
      }
    });
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

  deletePacket(packet: Packet): void {
    if (!window.confirm(`Delete packet "${packet.name}"? This cannot be undone.`)) {
      return;
    }
    this.packetAuthoring.deletePacket(packet.id).subscribe({
      next: () => {
        this.snackBar.open('Packet deleted', 'Dismiss', { duration: 2500 });
        this.packets = this.packets.filter(p => p.id !== packet.id);
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  private extractError(err: any): string {
    return err?.error?.errors?.[0]?.message || 'Something went wrong.';
  }
}
