import { Component, DestroyRef, inject, OnInit, TemplateRef, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GameSession,
  GameSettings,
  MatchState,
  Packet,
  PlayerMode,
  ProcessError,
  PROCESS_ERROR_PACKET_NOT_AVAILABLE,
  processErrorMessage,
  Team
} from '../../models/sockbowl/sockbowl-interfaces';
import { Observable } from 'rxjs';
import { GameStateService } from '../../services/game-state.service';
import { GameMessageService } from '../../services/game-message.service';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { PendingPacketService } from '../../services/pending-packet.service';
import { PacketSearchComponent } from '../packet-search/packet-search.component';
import { PacketPreviewComponent } from '../packet-preview/packet-preview.component';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { PresentationConnectionState } from '../../models/cast-interfaces';

/** How long the proctor preview waits for the server to resend the packet. */
const PREVIEW_TIMEOUT_MS = 5000;

@Component({
    selector: 'app-game-config',
    templateUrl: './game-config.component.html',
    styleUrls: ['./game-config.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class GameConfigComponent implements OnInit {
  gameStateService = inject(GameStateService);
  private gameMessageService = inject(GameMessageService);
  private sockbowlQuestionsService = inject(SockbowlQuestionsService);
  private pendingPacketService = inject(PendingPacketService);
  private dialog = inject(MatDialog);
  private snack = inject(MatSnackBar);
  private presentationConnectionService = inject(PresentationConnectionService);
  private castStateService = inject(CastStateService);

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  packetId = '';
  selectedPacketId = '';
  bonusesEnabled = false;
  selectedPacket: Packet | null = null;

  // Timer settings
  tossupTimerSeconds = 5;
  bonusTimerSeconds = 5;
  autoTimerEnabled = true;
  readingWordsPerSecond = 4;

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  protected readonly PlayerMode = PlayerMode;
  protected readonly PresentationConnectionState = PresentationConnectionState;

  @ViewChild('packetSearchModal') packetSearchModal!: TemplateRef<any>;

  /** A preview was asked for while the session lacked the questions. */
  private previewPending = false;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => this.clearPreviewTimer());
    this.gameSessionObs = this.gameStateService.gameSession$;
    this.castAvailable$ = this.presentationConnectionService.isAvailable$;
    this.castConnectionState$ = this.presentationConnectionService.connectionState$;
  }

  ngOnInit(): void {
    this.gameSessionObs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((gameSession) => {
      this.gameSession = gameSession;
      this.applyPendingPacketIfReady(gameSession);

      // Initialize timer settings from game session
      if (gameSession.gameSettings?.timerSettings) {
        this.tossupTimerSeconds = gameSession.gameSettings.timerSettings.tossupTimerSeconds;
        this.bonusTimerSeconds = gameSession.gameSettings.timerSettings.bonusTimerSeconds;
        this.autoTimerEnabled = gameSession.gameSettings.timerSettings.autoTimerEnabled;
        this.readingWordsPerSecond = gameSession.gameSettings.timerSettings.readingWordsPerSecond;
      }

      this.syncSelectedPacket(gameSession.currentMatch?.packet);

      const sessionPacket = gameSession.currentMatch?.packet;
      if (this.previewPending && sessionPacket?.id && GameConfigComponent.hasQuestions(sessionPacket)) {
        this.previewPending = false;
        this.clearPreviewTimer();
        this.showPreview(sessionPacket);
      }
    });

    // Subscribe to ProcessError messages to show error toasts
    this.gameMessageService.gameEventObservables['ProcessError']
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((error: ProcessError) => {
        if (error?.error || error?.code) {
          this.snack.open(processErrorMessage(error), 'Dismiss', { duration: 5000 });
        }
        if (error?.code === PROCESS_ERROR_PACKET_NOT_AVAILABLE) {
          // The dialog's pick was optimistic; the server kept the old packet
          // (or none), so show what the session really has.
          this.revertToSessionPacket();
        }
      });
  }

  /**
   * Keep the config screen's packet (name, bonus count) in step with the
   * session. Nothing here asks the questions service: the proctor's full
   * packet comes from the game server (D2), and everyone else takes the name
   * and counts from MatchPacketUpdate, which game-state keeps on the session
   * packet. A non-proctor's session packet has no id (WP-FIXG5), so "a packet
   * is set" is decided by isPacketSet, not by the id.
   */
  private syncSelectedPacket(sessionPacket: Packet | null | undefined): void {
    if (!GameConfigComponent.isPacketSet(sessionPacket)) {
      // A proctor seat change or mode change cleared the packet
      // (MatchPacketUpdate{packetId:null, tossupCount:0}); drop our stale
      // display so the config UI doesn't keep showing a packet that no
      // longer exists on the session.
      if (this.selectedPacketId || this.selectedPacket) {
        this.selectedPacketId = '';
        this.selectedPacket = null;
      }
      return;
    }
    if (!sessionPacket.id) {
      // Non-proctor view: metadata only, never an id to fetch by.
      this.selectedPacketId = '';
      this.selectedPacket = sessionPacket;
      return;
    }
    if (this.selectedPacketId !== sessionPacket.id.toString()) {
      this.selectedPacketId = sessionPacket.id.toString();
      this.selectedPacket = sessionPacket;
      if (!GameConfigComponent.hasQuestions(sessionPacket) && this.gameStateService.isSelfProctor()) {
        // A packet change arrives without questions; the proctor gets the
        // full packet from the game server, never from questions (D2).
        this.gameStateService.requestGameSession();
      }
    } else if (!GameConfigComponent.hasQuestions(this.selectedPacket)
        && (Array.isArray(sessionPacket.bonuses) || GameConfigComponent.hasQuestions(sessionPacket))) {
      // The full packet (proctor), or the server's own counts from
      // MatchPacketUpdate, replace what the packet dialog handed us.
      this.selectedPacket = sessionPacket;
    }
  }

  /** Drop an optimistic pick the server refused, back to the session's packet. */
  private revertToSessionPacket(): void {
    const sessionPacket = this.gameSession?.currentMatch?.packet;
    this.packetId = sessionPacket?.id ?? '';
    this.selectedPacketId = '';
    this.selectedPacket = null;
    this.syncSelectedPacket(sessionPacket);
  }

  /** Whether the session has a packet set (by id, or by name and count for a non-proctor). */
  isPacketSet(): boolean {
    return GameConfigComponent.isPacketSet(this.gameSession?.currentMatch?.packet);
  }

  private static isPacketSet(packet: Packet | null | undefined): packet is Packet {
    return !!packet && (!!packet.id || !!packet.name || (packet.tossups?.length ?? 0) > 0);
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

  /** True once at least one player has joined a team (a match needs players). */
  hasAnyPlayers(): boolean {
    return (this.gameSession?.teamList ?? []).some(t => (t.teamPlayers?.length ?? 0) > 0);
  }

  canBecomeProctor(): boolean {
    // Proctorless modes have no proctor role.
    if (this.gameStateService.isProctorless()) {
      return false;
    }
    const proctor = this.gameStateService.getProctor();
    const isProctor =
      !!proctor && proctor.playerId === this.gameStateService.playerSessionId;
    const isGameOwner = this.gameStateService.isCurrentPlayerGameOwner();
    const noProctor = !proctor;

    return (noProctor || isGameOwner) && !isProctor;
  }

  /**
   * Whether the current player may manage config (pick/preview packet, start).
   * The proctor manages a normal game; in single player the lone owner does.
   */
  canManageConfig(): boolean {
    return this.gameStateService.isSelfProctor()
      || this.gameStateService.isSinglePlayer()
      || (this.gameStateService.isAutoJudgedMultiplayer() && this.gameStateService.isCurrentPlayerGameOwner());
  }

  becomeProctor(): void {
    this.gameStateService.setSelfProctor();
    this.snack.open('You are now the proctor.', 'OK', { duration: 2500 });
  }

  /* ─── Packet ───────────────────────────────────────────────────────────── */

  setPacket(): void {
    this.gameStateService.setMatchPacket(this.packetId);
  }

  /**
   * Consume the builder's "Play test" pending packet (PB-15), if any, once
   * the match is in CONFIG and the local player may set it — the owner in a
   * proctorless mode, or the proctor. Clears the pending id immediately so
   * this only ever fires once, even though later session updates (including
   * the echo of our own setMatchPacket call) re-run this same subscription.
   */
  private applyPendingPacketIfReady(gameSession: GameSession): void {
    const pendingPacketId = this.pendingPacketService.get();
    if (!pendingPacketId) return;
    if (gameSession.currentMatch?.matchState !== MatchState.CONFIG) return;
    if (!this.mayApplyPendingPacket()) return;

    this.pendingPacketService.clear();
    this.gameStateService.setMatchPacket(pendingPacketId);
    this.sockbowlQuestionsService.getPacketById(pendingPacketId).subscribe({
      next: (packet) => this.snack.open(`Packet '${packet?.name ?? pendingPacketId}' selected.`, 'OK', { duration: 2500 }),
      error: () => this.snack.open('Packet selected.', 'OK', { duration: 2500 }),
    });
  }

  private mayApplyPendingPacket(): boolean {
    return this.gameStateService.isSelfProctor()
      || (this.gameStateService.isProctorless() && this.gameStateService.isCurrentPlayerGameOwner());
  }

  /**
   * Proctor-only: open a read-through of the set packet's questions and
   * answers. The packet comes from the game session, which the game server
   * sends in full only to the proctor; the questions service is never asked
   * for answers (D2). If this copy of the session lacks the questions (a
   * packet change arrives without them), ask the server to resend the session
   * and open the preview when it lands.
   */
  openPacketPreview(): void {
    const packet = this.gameSession?.currentMatch?.packet;
    if (!packet?.id) return;
    if (GameConfigComponent.hasQuestions(packet)) {
      this.showPreview(packet);
      return;
    }
    this.previewPending = true;
    this.clearPreviewTimer();
    this.previewTimer = setTimeout(() => {
      if (this.previewPending) {
        this.previewPending = false;
        this.snack.open('The packet preview is not available right now.', 'Dismiss', { duration: 4000 });
      }
    }, PREVIEW_TIMEOUT_MS);
    this.gameStateService.requestGameSession();
  }

  private showPreview(packet: Packet): void {
    this.dialog.open(PacketPreviewComponent, {
      width: '760px', maxWidth: '94vw', panelClass: 'preview-dialog', data: packet
    });
  }

  private clearPreviewTimer(): void {
    if (this.previewTimer) {
      clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
  }

  /** Whether a packet carries its questions (not just an id, name and count). */
  private static hasQuestions(packet: Packet | null | undefined): packet is Packet {
    return Array.isArray(packet?.tossups) && packet.tossups.some(t => !!t);
  }

  openPacketSearch(): void {
    const dialogRef = this.dialog.open(PacketSearchComponent, {
      width: '680px',
      maxWidth: '96vw'
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
    // Only the proctor (or the owner in proctorless modes) may change settings;
    // the backend rejects anyone else, so guard here too — matching
    // updateTimerSettings — instead of firing a doomed round-trip. Revert the
    // optimistic ngModel flip so the toggle doesn't show a state that won't stick.
    if (!this.canEditTimerSettings()) {
      this.bonusesEnabled = !this.bonusesEnabled;
      return;
    }
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
   * Whether the current player may edit Timer Settings. Classic mode: proctor only.
   * AUTO_PROCTOR has no proctor role, so the game owner edits instead (mirrors the
   * backend's existing proctorless-owner authorization in updateGameSettings).
   */
  canEditTimerSettings(): boolean {
    return this.gameStateService.isSelfProctor()
      || (this.gameStateService.isAutoJudgedMultiplayer() && this.gameStateService.isCurrentPlayerGameOwner());
  }

  /**
   * Update timer settings in game state (only if current player may edit them)
   */
  updateTimerSettings(): void {
    if (!this.canEditTimerSettings()) {
      return;
    }

    const updatedSettings = new GameSettings({
      proctorType: this.gameSession.gameSettings.proctorType,
      gameMode: this.gameSession.gameSettings.gameMode,
      bonusesEnabled: this.gameSession.gameSettings.bonusesEnabled,
      timerSettings: {
        tossupTimerSeconds: this.tossupTimerSeconds,
        bonusTimerSeconds: this.bonusTimerSeconds,
        autoTimerEnabled: this.autoTimerEnabled,
        readingWordsPerSecond: this.readingWordsPerSecond
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
