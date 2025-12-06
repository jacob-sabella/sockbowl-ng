import { Component, Input } from '@angular/core';
import { Team, Buzz, Round } from '../../models/sockbowl/sockbowl-interfaces';
import { GameStateService } from '../../services/game-state.service';

@Component({
  selector: 'app-team-list',
  templateUrl: './team-list.component.html',
  styleUrls: ['./team-list.component.scss']
})
export class TeamListComponent {
  @Input() teams!: Team[];
  @Input() currentBuzz!: Buzz;
  @Input() currentRound!: Round
  @Input() previousRoundList!: Round[];

  constructor(private gameStateService: GameStateService) {}

  isCurrentPlayer(playerId: string): boolean {
    return this.gameStateService.getCurrentPlayer()?.playerId === playerId;
  }

  isCurrentBuzz(playerId: string): boolean {
    return this.currentBuzz && this.currentBuzz.playerId === playerId;
  }

  hasTeamBuzzed(teamId: string): boolean {
    return this.currentRound && this.currentRound.buzzList.some(buzz => buzz.teamId === teamId);
  }

  getPlayerScore(playerId: string): number {
    let score = 0;

    // Calculate score from previous rounds
    this.previousRoundList.forEach(round => {
      score += round.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    });

    // Add score from the current buzz if it's correct and belongs to the player
    score += this.currentRound.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;

    return score;
  }

  getTeamScore(team: Team): number {
    return team.teamPlayers.reduce((total, player) => total + this.getPlayerScore(player.playerId), 0);
  }
}
