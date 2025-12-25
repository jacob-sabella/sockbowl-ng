import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GameSession,
  GameSettings,
  Packet,
  PlayerMode,
  Team
} from '../../models/sockbowl/sockbowl-interfaces';
import { Observable } from 'rxjs';
import { GameStateService } from '../../services/game-state.service';
import { PacketSearchComponent } from '../packet-search/packet-search.component';

@Component({
  selector: 'app-game-config',
  templateUrl: './game-config.component.html',
  styleUrls: ['./game-config.component.scss']
})
export class GameConfigComponent implements OnInit {
  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  packetId: String = '';
  selectedPacketId: String = '';
  bonusesEnabled: boolean = false;
  selectedPacket: Packet | null = null;

  protected readonly PlayerMode = PlayerMode;

  @ViewChild('packetSearchModal') packetSearchModal!: TemplateRef<any>;

  constructor(
    public gameStateService: GameStateService,
    private dialog: MatDialog,
    private snack: MatSnackBar
  ) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe((gameSession) => {
      this.gameSession = gameSession;
    });
  }

  /* ─── Teams ─────────────────────────────────────────────────────────────── */

  joinTeam(team: Team): void {
    this.joinTeamWithId(team.teamId);
  }

  joinTeamWithId(teamId: string) {
    this.gameStateService.updateTeamSelf(teamId);
  }

  switchToSpectate() {
    this.joinTeamWithId('SPECTATE');
  }

  /* ─── Proctor ──────────────────────────────────────────────────────────── */

  canBecomeProctor(): boolean {
    const proctor = this.gameStateService.getProctor();
    const isProctor =
      !!proctor && proctor.playerId === this.gameStateService.playerSessionId;
    const isGameOwner = this.gameStateService.isCurrentPlayerGameOwner();
    const noProctor = !proctor;

    return (noProctor || isGameOwner) && !isProctor;
  }

  becomeProctor(): void {
    this.gameStateService.setSelfProctor();
    this.snack.open('You are now the proctor.', 'OK', { duration: 2500 });
  }

  /* ─── Packet ───────────────────────────────────────────────────────────── */

  setPacket(): void {
    this.gameStateService.setMatchPacket(this.packetId);
  }

  openPacketSearch(): void {
    const dialogRef = this.dialog.open(PacketSearchComponent, {
      width: '900px',
      maxWidth: '95vw'
    });

    dialogRef.afterClosed().subscribe((result: Packet) => {
      if (result) {
        this.packetId = result.id;
        this.selectedPacketId = result.id;
        this.selectedPacket = result;  // Store full packet for bonus info
        this.gameStateService.setMatchPacket(this.packetId);
        this.snack.open('Packet selected.', 'OK', { duration: 2000 });

        // Reset bonuses if packet doesn't have any
        if (!this.hasPacketBonuses() && this.bonusesEnabled) {
          this.bonusesEnabled = false;
          this.toggleBonuses();
        }
      }
    });
  }

  /* ─── Bonuses ───────────────────────────────────────────────────────────── */

  /**
   * Check if selected packet has bonuses
   */
  hasPacketBonuses(): boolean {
    return !!(this.selectedPacket?.bonuses?.length);
  }

  /**
   * Toggle bonuses enabled setting
   */
  toggleBonuses(): void {
    const updatedSettings = new GameSettings({
      proctorType: this.gameSession.gameSettings.proctorType,
      gameMode: this.gameSession.gameSettings.gameMode,
      bonusesEnabled: this.bonusesEnabled
    });

    this.gameStateService.updateGameSettings(updatedSettings);
  }

  /**
   * Get bonus count for display
   */
  getBonusCount(): number {
    return this.selectedPacket?.bonuses?.length || 0;
  }

  /* ─── Progression ──────────────────────────────────────────────────────── */

  startMatch(): void {
    this.gameStateService.startMatch();
  }

  /* ─── UI helpers ───────────────────────────────────────────────────────── */

  copyJoinCode(code: string | undefined) {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.snack.open('Join code copied to clipboard.', 'OK', { duration: 2000 });
    });
  }

  trackByTeamId(_: number, t: Team) {
    return t.teamId;
  }

  trackByPlayerId(_: number, p: { playerId: string }) {
    return p.playerId;
  }
}
