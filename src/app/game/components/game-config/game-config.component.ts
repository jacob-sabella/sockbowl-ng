import { Component, Input, OnInit } from '@angular/core';
import { GameSession, Player, PlayerMode, Team } from "../../models/sockbowl/sockbowl-interfaces";
import { Observable } from "rxjs";
import { GameStateService } from "../../services/game-state.service";

@Component({
  selector: 'app-game-config',
  templateUrl: './game-config.component.html',
  styleUrls: ['./game-config.component.scss']
})
export class GameConfigComponent implements OnInit {

  gameSessionObs!: Observable<GameSession>;
  gameSession! : GameSession;
  packetId: number = 0;

  /**
   * Readonly property for PlayerMode enum to use in the template
   */
  protected readonly PlayerMode = PlayerMode;

  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  /**
   * OnInit lifecycle hook to subscribe to the game session observable
   */
  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;
    });
  }

  // ----------------------
  // Team Related Methods
  // ----------------------

  /**
   * Assigns the current player to a team.
   * @param team The team to join.
   */
  joinTeam(team: Team): void {
    this.joinTeamWithId(team.teamId);
  }

  /**
   * Assigns the current player to a team by team ID.
   * @param teamId The ID of the team to join.
   */
  joinTeamWithId(teamId: string) {
    this.gameStateService.updateTeamSelf(teamId);
  }

  /**
   * Switches the current player to spectator mode.
   */
  switchToSpectate() {
    this.joinTeamWithId("SPECTATE")
  }

  // ------------------------
  // Proctor Related Methods
  // ------------------------

  /**
   * Checks if the current player can become the proctor.
   * @returns true if the current player can become the proctor; otherwise false.
   */
  canBecomeProctor(): boolean {
    const proctor = this.gameStateService.getProctor();
    const isProctor = proctor && proctor.playerId === this.gameStateService.playerSessionId;
    const isGameOwner = this.gameStateService.isCurrentPlayerGameOwner();
    const noProctor = !proctor;

    return (noProctor || isGameOwner) && !isProctor;
  }

  /**
   * Sets the current player as the proctor.
   */
  becomeProctor(): void {
    this.gameStateService.setSelfProctor();
  }


  // --------------------------
  // Packet methods
  // --------------------------

  /**
   * Sets the packet with a static ID.
   */
  setPacket(): void {
    this.gameStateService.setMatchPacket(this.packetId);
  }

  // --------------------------
  // Progression methods
  // --------------------------
  startMatch(): void {
    this.gameStateService.startMatch();
  }
}
