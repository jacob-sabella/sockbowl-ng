import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GameSession,
  GameSettings,
  Packet,
  PlayerMode,
  ProcessError,
  Team,
  TimerSettings
} from '../../models/sockbowl/sockbowl-interfaces';
import { Observable } from 'rxjs';
import { GameStateService } from '../../services/game-state.service';
import { GameMessageService } from '../../services/game-message.service';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { PacketSearchComponent } from '../packet-search/packet-search.component';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { PresentationConnectionState } from '../../models/cast-interfaces';

@Component({
    selector: 'app-game-config',
    templateUrl: './game-config.component.html',
    styleUrls: ['./game-config.component.scss'],
    standalone: false
})
export class GameConfigComponent implements OnInit {
  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  packetId: String = '';
  selectedPacketId: String = '';
  bonusesEnabled: boolean = false;
  selectedPacket: Packet | null = null;

  // Timer settings
  tossupTimerSeconds: number = 5;
  bonusTimerSeconds: number = 5;
  autoTimerEnabled: boolean = true;

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  protected readonly PlayerMode = PlayerMode;
  protected readonly PresentationConnectionState = PresentationConnectionState;

  @ViewChild('packetSearchModal') packetSearchModal!: TemplateRef<any>;

  constructor(
    public gameStateService: GameStateService,
    private gameMessageService: GameMessageService,
    private sockbowlQuestionsService: SockbowlQuestionsService,
    private dialog: MatDialog,
    private snack: MatSnackBar,
    private presentationConnectionService: PresentationConnectionService,
    private castStateService: CastStateService // Injecting initializes state subscription
  ) {
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.castAvailable$ = this.presentationConnectionService.isAvailable$;
    this.castConnectionState$ = this.presentationConnectionService.connectionState$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe((gameSession) => {
      this.gameSession = gameSession;

      // Initialize timer settings from game session
      if (gameSession.gameSettings?.timerSettings) {
        this.tossupTimerSeconds = gameSession.gameSettings.timerSettings.tossupTimerSeconds;
        this.bonusTimerSeconds = gameSession.gameSettings.timerSettings.bonusTimerSeconds;
        this.autoTimerEnabled = gameSession.gameSettings.timerSettings.autoTimerEnabled;
      }

      // Fetch full packet data with bonuses if packet is set AND we don't already have it
      if (gameSession.currentMatch?.packet?.id &&
          this.selectedPacketId !== gameSession.currentMatch.packet.id.toString()) {
        const packetId = gameSession.currentMatch.packet.id.toString();

        // Fetch full packet details including bonuses
        this.sockbowlQuestionsService.getPacketById(packetId).subscribe(
          (packet) => {
            if (packet) {
              this.selectedPacket = packet;
              this.selectedPacketId = packet.id;
            }
          },
          (error) => {
            console.error('Error fetching packet details:', error);
            // Fallback to basic packet from session
            this.selectedPacket = gameSession.currentMatch.packet;
            this.selectedPacketId = gameSession.currentMatch.packet.id;
          }
        );
      }
    });

    // Subscribe to ProcessError messages to show error toasts
    this.gameMessageService.gameEventObservables['ProcessError']?.subscribe((error: ProcessError) => {
      if (error?.error) {
        this.snack.open(error.error, 'Dismiss', { duration: 5000 });
      }
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
      bonusesEnabled: this.bonusesEnabled,
      timerSettings: this.gameSession.gameSettings.timerSettings
    });

    this.gameStateService.updateGameSettings(updatedSettings);
  }

  /**
   * Get bonus count for display
   */
  getBonusCount(): number {
    return this.selectedPacket?.bonuses?.length || 0;
  }

  /* ─── Timer Settings ────────────────────────────────────────────────────── */

  /**
   * Update timer settings in game state (only if current player is proctor)
   */
  updateTimerSettings(): void {
    // Only proctor can update settings
    if (!this.gameStateService.isSelfProctor()) {
      return;
    }

    const updatedSettings = new GameSettings({
      proctorType: this.gameSession.gameSettings.proctorType,
      gameMode: this.gameSession.gameSettings.gameMode,
      bonusesEnabled: this.gameSession.gameSettings.bonusesEnabled,
      timerSettings: {
        tossupTimerSeconds: this.tossupTimerSeconds,
        bonusTimerSeconds: this.bonusTimerSeconds,
        autoTimerEnabled: this.autoTimerEnabled
      }
    });

    this.gameStateService.updateGameSettings(updatedSettings);
    // Toast only shown on error (via ProcessError subscription)
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

  /* ─── Casting ──────────────────────────────────────────────────────────── */

  /**
   * Initiates casting to a presentation device.
   * Opens the browser's device picker for the user to select a cast target.
   */
  startCasting(): void {
    this.presentationConnectionService.startPresentation();
  }

  /**
   * Stops the active casting session.
   */
  stopCasting(): void {
    this.presentationConnectionService.stopPresentation();
  }
}
