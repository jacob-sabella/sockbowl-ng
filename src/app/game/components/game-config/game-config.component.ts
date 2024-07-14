import { Component, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GameSession, Packet, PlayerMode, Team } from "../../models/sockbowl/sockbowl-interfaces";
import { Observable } from "rxjs";
import { GameStateService } from "../../services/game-state.service";
import {PacketSearchComponent} from "../packet-search/packet-search.component";

@Component({
  selector: 'app-game-config',
  templateUrl: './game-config.component.html',
  styleUrls: ['./game-config.component.scss']
})
export class GameConfigComponent implements OnInit {

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;
  packetId: String = "";
  selectedPacketId: String = "";

  @ViewChild('packetSearchModal') packetSearchModal!: TemplateRef<any>;

  protected readonly PlayerMode = PlayerMode;

  constructor(
    public gameStateService: GameStateService,
    private dialog: MatDialog
  ) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;
    });
  }

  // Team Related Methods
  joinTeam(team: Team): void {
    this.joinTeamWithId(team.teamId);
  }

  joinTeamWithId(teamId: string) {
    this.gameStateService.updateTeamSelf(teamId);
  }

  switchToSpectate() {
    this.joinTeamWithId("SPECTATE")
  }

  // Proctor Related Methods
  canBecomeProctor(): boolean {
    const proctor = this.gameStateService.getProctor();
    const isProctor = proctor && proctor.playerId === this.gameStateService.playerSessionId;
    const isGameOwner = this.gameStateService.isCurrentPlayerGameOwner();
    const noProctor = !proctor;

    return (noProctor || isGameOwner) && !isProctor;
  }

  becomeProctor(): void {
    this.gameStateService.setSelfProctor();
  }

  // Packet Methods
  setPacket(): void {
    this.gameStateService.setMatchPacket(this.packetId);
  }

  openPacketSearch(): void {
    const dialogRef = this.dialog.open(PacketSearchComponent);

    dialogRef.afterClosed().subscribe((result: Packet) => {
      if (result) {
        this.packetId = result.id;
        this.selectedPacketId = result.id;
        this.gameStateService.setMatchPacket(this.packetId);
      }
    });
  }

  // Progression methods
  startMatch(): void {
    this.gameStateService.startMatch();
  }
}
