import { Component, DestroyRef, inject, OnInit, TemplateRef, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  GameSession,
  GameSettings,
  MatchState,
  Packet,
  Player,
  PlayerMode,
  ProcessError,
  PROCESS_ERROR_PACKET_NOT_AVAILABLE,
  processErrorMessage,
  Team
} from '../../models/sockbowl/sockbowl-interfaces';
import { Observable } from 'rxjs';
import { GameStateService } from '../../services/game-state.service';
import { GameMessageService } from '../../services/game-message.service';
import { PendingPacketService } from '../../services/pending-packet.service';
import { PacketSearchComponent } from '../packet-search/packet-search.component';
import { PacketPreviewComponent } from '../packet-preview/packet-preview.component';
import { PresentationConnectionService } from '../../services/presentation-connection.service';
import { CastStateService } from '../../services/cast-state.service';
import { PresentationConnectionState } from '../../models/cast-interfaces';

/** How long the proctor preview waits for the server to resend the packet. */
const PREVIEW_TIMEOUT_MS = 5000;

/**
 * How long the Start button stays disabled after a click (S3-09), in case
 * the match never actually starts (a dropped message) and no ProcessError
 * arrives either — a normal start or a real error both clear it sooner.
 */
const START_PENDING_TIMEOUT_MS = 6000;

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
  /**
   * The session's last-confirmed timer values (S3-09): what a field reverts
   * to on commit if the user cleared it rather than typing a new number.
   */
  private committedTimer = { tossup: 5, bonus: 5, reading: 4 };

  /** Guards the Start button against a double click while the server hasn't replied yet (S3-09). */
  startPending = false;
  private startPendingTimer: ReturnType<typeof setTimeout> | null = null;

  // Cast-related observables
  castAvailable$: Observable<boolean>;
  castConnectionState$: Observable<PresentationConnectionState>;

  protected readonly PresentationConnectionState = PresentationConnectionState;

  @ViewChild('packetSearchModal') packetSearchModal!: TemplateRef<any>;

  /** A preview was asked for while the session lacked the questions. */
  private previewPending = false;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The pending packet id `applyPendingPacketIfReady` just sent through
   * `setMatchPacket`, if the game hasn't echoed it back on the session yet
   * (NG-V1-06). Cleared once the echo arrives (a confirmation snackbar
   * fires) or the server refuses it (`revertToSessionPacket`), whichever
   * comes first.
   */
  private awaitingPacketConfirmationId: string | null = null;

  private destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearPreviewTimer();
      this.clearStartPendingTimer();
    });
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
        // S3-09: what a cleared timer field reverts to on commit.
        this.committedTimer = {
          tossup: this.tossupTimerSeconds,
          bonus: this.bonusTimerSeconds,
          reading: this.readingWordsPerSecond,
        };
      }
      // S3-03 (impeccable polish): the toggle used to stay unchecked forever —
      // it was never loaded from the session, only ever written to it.
      this.bonusesEnabled = !!gameSession.gameSettings?.bonusesEnabled;

      this.syncSelectedPacket(gameSession.currentMatch?.packet);
      this.confirmPendingPacketIfEchoed(gameSession.currentMatch?.packet);

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
          // Whatever failed, the match didn't just start — free Start back up (S3-09).
          this.clearStartPendingTimer();
          this.startPending = false;
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
    // NG-V1-06: the server just refused a set, so it will never echo the
    // pending id back — stop waiting for a confirmation that isn't coming.
    this.awaitingPacketConfirmationId = null;
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
   *
   * NG-V1-06: this used to confirm with a snackbar as soon as the separate
   * `getPacketById` questions-service call returned, regardless of whether
   * the game actually accepted `setMatchPacket` — a PACKET_NOT_AVAILABLE or
   * PACKET_EMPTY error snackbar could be overwritten by that "selected"
   * success snackbar landing after it (MatSnackBar shows one message at a
   * time). It now waits for the game's own echo instead — see
   * `confirmPendingPacketIfEchoed`, called from the same `gameSession$`
   * subscription this method runs from.
   */
  private applyPendingPacketIfReady(gameSession: GameSession): void {
    const pendingPacketId = this.pendingPacketService.get();
    if (!pendingPacketId) return;
    if (gameSession.currentMatch?.matchState !== MatchState.CONFIG) return;
    if (!this.mayApplyPendingPacket()) return;

    this.pendingPacketService.clear();
    this.awaitingPacketConfirmationId = pendingPacketId;
    this.gameStateService.setMatchPacket(pendingPacketId);
  }

  /**
   * NG-V1-06: shows the "Packet selected" confirmation only once the game's
   * own `MatchPacketUpdate` echoes back the id `applyPendingPacketIfReady`
   * just sent — never from a separate, unrelated questions-service fetch.
   * The name is already on the session (`syncSelectedPacket`'s doc comment),
   * so no extra call is needed to show it.
   */
  private confirmPendingPacketIfEchoed(sessionPacket: Packet | null | undefined): void {
    if (!this.awaitingPacketConfirmationId) return;
    if (sessionPacket?.id?.toString() !== this.awaitingPacketConfirmationId) return;

    this.awaitingPacketConfirmationId = null;
    this.snack.open(`Packet '${sessionPacket.name ?? this.selectedPacketId}' selected.`, 'OK', { duration: 2500 });
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
    // S3-10 (r3): below 600px (the same breakpoint packet-search's own SCSS
    // uses for its full-screen rule) the picker opens edge-to-edge so its
    // three tabs and the sticky footer all fit without fighting a centered
    // panel for room. `packet-search-dialog--fullscreen` is read there via
    // `:host-context` — no dialog-config change needed above 600px.
    const isCompact = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 600px)').matches;
    const config: MatDialogConfig = isCompact
      ? { width: '100vw', maxWidth: '100vw', height: '100dvh', maxHeight: '100dvh', panelClass: 'packet-search-dialog--fullscreen' }
      : { width: '680px', maxWidth: '96vw' };
    const dialogRef = this.dialog.open(PacketSearchComponent, config);

    dialogRef.afterClosed().subscribe((result: Packet) => {
      if (result) {
        this.packetId = result.id;
        this.selectedPacketId = result.id;
        this.selectedPacket = result;  // Store full packet for bonus info
        // S3-19: this pick was optimistic too (the dialog never asked the
        // game server), so the confirmation waits for the same server echo
        // `confirmPendingPacketIfEchoed` already waits for — never fired
        // just because the dialog closed with something in hand.
        this.awaitingPacketConfirmationId = result.id?.toString() ?? null;
        this.gameStateService.setMatchPacket(this.packetId);

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

  /** Tossup count for display, alongside getBonusCount() (S3-08). */
  getTossupCount(): number {
    return this.selectedPacket?.tossups?.length || 0;
  }

  /**
   * The packet's visibility badge text (S3-08): EPHEMERAL/DRAFT/PUBLISHED,
   * read off whichever seat's view carries it. A non-proctor's session
   * packet may not carry visibility at all (H-03); this only ever shows
   * what the local view actually has, it never guesses.
   */
  packetVisibilityLabel(): string | null {
    switch (this.selectedPacket?.visibility) {
      case 'EPHEMERAL': return 'Game-only, 24h';
      case 'DRAFT': return 'Draft';
      case 'PUBLISHED': return 'Published';
      default: return null;
    }
  }

  /* ─── Timer Settings ────────────────────────────────────────────────────── */

  /**
   * Whether the current player may edit Timer Settings. Classic mode: proctor only.
   * AUTO_PROCTOR has no proctor role, so the game owner edits instead (mirrors the
   * backend's existing proctorless-owner authorization in updateGameSettings).
   */
  canEditTimerSettings(): boolean {
    // S3-25: the backend's updateGameSettings authorizes the session owner
    // for every proctorless mode (isProctorless(), which is single-player OR
    // auto-judged multiplayer), not just auto-judged multiplayer — this used
    // to exclude single-player, so a solo owner saw their own timers as
    // read-only even though the server would have accepted the change.
    return this.gameStateService.isSelfProctor()
      || (this.gameStateService.isProctorless() && this.gameStateService.isCurrentPlayerGameOwner());
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

  /**
   * Commits the tossup timer field on change/blur, not on every keystroke
   * (S3-09): clamps to [1,60] and reverts an emptied field to the last
   * value the session confirmed, rather than sending `null`.
   */
  commitTossupTimer(): void {
    this.tossupTimerSeconds = this.clampTimerField(this.tossupTimerSeconds, 1, 60, this.committedTimer.tossup);
    this.committedTimer.tossup = this.tossupTimerSeconds;
    this.updateTimerSettings();
  }

  /** Same contract as {@link commitTossupTimer}, for the bonus timer (S3-09). */
  commitBonusTimer(): void {
    this.bonusTimerSeconds = this.clampTimerField(this.bonusTimerSeconds, 1, 60, this.committedTimer.bonus);
    this.committedTimer.bonus = this.bonusTimerSeconds;
    this.updateTimerSettings();
  }

  /** Same contract as {@link commitTossupTimer}, for the reading-speed field (S3-09). */
  commitReadingSpeed(): void {
    this.readingWordsPerSecond = this.clampTimerField(this.readingWordsPerSecond, 1, 10, this.committedTimer.reading);
    this.committedTimer.reading = this.readingWordsPerSecond;
    this.updateTimerSettings();
  }

  /** Clamp to [min,max] on commit; an empty/NaN field reverts to `fallback` instead of sending it (S3-09). */
  private clampTimerField(raw: number | null | undefined, min: number, max: number, fallback: number): number {
    if (raw === null || raw === undefined || (raw as unknown as string) === '' || Number.isNaN(Number(raw))) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(Number(raw))));
  }

  /* ─── Progression ──────────────────────────────────────────────────────── */

  startMatch(): void {
    // Guard against a double click/tap firing two StartMatch messages (S3-09):
    // the match should start once, not race to start twice.
    if (this.startPending) return;
    this.startPending = true;
    this.gameStateService.startMatch();
    this.clearStartPendingTimer();
    this.startPendingTimer = setTimeout(() => { this.startPending = false; }, START_PENDING_TIMEOUT_MS);
  }

  private clearStartPendingTimer(): void {
    if (this.startPendingTimer) {
      clearTimeout(this.startPendingTimer);
      this.startPendingTimer = null;
    }
  }

  /** Why Start is disabled right now, stated in words (S3-17). Empty once ready. */
  startDisabledReason(): string {
    return this.isPacketSet() ? '' : 'Choose a packet to start';
  }

  /**
   * The Start button's own label (S3-21/S3-09): "Starting…" while a click is
   * in flight, so the button doesn't just sit there disabled with no
   * explanation for the gap before the match actually starts.
   */
  startButtonLabel(): string {
    return this.startPending ? 'Starting…' : 'Start Match';
  }

  /**
   * Total players in the room right now (S3-21): informational only, and
   * deliberately never a gate — Start stays gated on the packet alone
   * (contract STORY step 6 / `startDisabledReason`). Mirrors the template's
   * own FFA/team-based branch (`isFreeForAll`) so this counts the same
   * players the Teams/Players card shows.
   */
  playerCount(): number {
    if (this.gameStateService.isFreeForAll()) {
      return (this.gameSession?.playerList ?? []).filter(p => p.playerMode === PlayerMode.BUZZER).length;
    }
    return (this.gameSession?.teamList ?? []).reduce((sum, t) => sum + (t.teamPlayers?.length ?? 0), 0);
  }

  /** The readiness strip's Players text (S3-21): a count, not an unchecked checklist step. */
  playerCountLabel(): string {
    const n = this.playerCount();
    return n === 0 ? '0 players yet' : `${n} ${n === 1 ? 'player' : 'players'}`;
  }

  /**
   * The name the non-manager status line waits on (S3-20): the proctor's
   * name in a proctor mode, or the game owner's name in a proctorless
   * multiplayer mode (nobody else manages config there — see
   * `canManageConfig`). Falls back to a generic "the host" before either is
   * known.
   */
  private managerName(): string {
    return this.gameStateService.getProctor()?.name
      || this.gameSession?.playerList?.find(p => p.gameOwner)?.name
      || 'the host';
  }

  /**
   * The launch bar's status line for everyone who isn't managing config
   * (S3-20 / contract STORY step 2): a seated player is told whose team
   * they're on and who they're waiting for, an unseated player is told to
   * pick a team, and a spectator is told they're watching. Previously this
   * slot was simply empty for every non-manager once a proctor (or owner)
   * was already in place. It's polite-live so a mode or seat change is
   * announced (html aria-live).
   */
  nonManagerStatusLine(): string {
    if (this.gameStateService.isSelfSpectator()) {
      return 'Watching as a spectator';
    }
    const team = this.gameStateService.getCurrentPlayerTeam();
    if (!team) {
      return 'Pick a team to play';
    }
    return `You're on ${team.teamName} · Waiting for ${this.managerName()} to start`;
  }

  /**
   * The "no packet yet" message (S3-20): only the manager can act on it, so
   * a non-manager gets a status sentence instead of an instruction they
   * can't follow ("Generate one from the question bank..."). Mirrors the
   * launch bar's own "proctor" / "the host" wording.
   */
  packetEmptyMessage(): string {
    if (this.canManageConfig()) {
      return 'No packet yet. Generate one from the question bank or search the library to set the questions for this match.';
    }
    return this.gameStateService.getProctor()
      ? "The proctor hasn't chosen a packet yet."
      : "The host hasn't chosen a packet yet.";
  }

  /* ─── UI helpers ───────────────────────────────────────────────────────── */

  copyJoinCode(code: string | undefined) {
    this.copyText(code, 'Join code copied to clipboard.');
  }

  /** Packet ID is a secondary, proctor-only detail (S3-08); still copyable. */
  copyPacketId(id: string | undefined) {
    this.copyText(id, 'Packet ID copied to clipboard.');
  }

  private copyText(text: string | undefined, confirmation: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.snack.open(confirmation, 'OK', { duration: 2000 });
    });
  }

  /** Whether this player is the signed-in viewer, for the "You" marker (S3-11). */
  isSelfPlayer(playerId: string | undefined): boolean {
    return !!playerId && this.gameStateService.getCurrentPlayer()?.playerId === playerId;
  }

  /**
   * The actual spectator list (S3-12): the template used to render every
   * player and hide the non-spectators with `[style.display]`, so an empty
   * spectator list rendered as a blank card instead of a designed empty
   * state (the empty-state check ran against the wrong array).
   */
  spectators(gameSession: GameSession): Player[] {
    return (gameSession.playerList ?? []).filter(p => p.playerMode === PlayerMode.SPECTATOR);
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

  /**
   * The cast control's label for its current state (S3-26). The control used
   * to render nothing at all while CONNECTING (the device picker is open),
   * so it appeared to vanish mid-handshake; every state now has words.
   */
  castButtonLabel(state: PresentationConnectionState | null): string {
    switch (state) {
      case PresentationConnectionState.CONNECTING:
        return 'Connecting…';
      case PresentationConnectionState.CONNECTED:
        return 'Casting · Stop';
      default:
        // DISCONNECTED, TERMINATED, or not yet known — all offer to start.
        return 'Cast to TV';
    }
  }

  /** The cast control's click handler (S3-26): disabled while connecting, so this never fires then. */
  onCastButtonClick(state: PresentationConnectionState | null): void {
    if (state === PresentationConnectionState.CONNECTED) {
      this.stopCasting();
    } else if (state !== PresentationConnectionState.CONNECTING) {
      this.startCasting();
    }
  }
}
