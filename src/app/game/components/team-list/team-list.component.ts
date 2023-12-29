import { Component, Input } from '@angular/core';
import { Team, Buzz, Round } from '../../models/sockbowl/sockbowl-interfaces';

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

  isCurrentBuzz(playerId: string): boolean {
    return this.currentBuzz && this.currentBuzz.playerId === playerId;
  }

  hasTeamBuzzed(teamId: string): boolean {
    return this.currentRound && this.currentRound.buzzList.some(buzz => buzz.teamId === teamId);
  }

  getPlayerScore(playerId: string): number {
    let score = 0;
    this.previousRoundList.forEach(round => {
      score += round.buzzList.filter(buzz => buzz.playerId === playerId && buzz.correct).length * 10;
    });
    return score;
  }

  getTeamScore(team: Team): number {
    return team.teamPlayers.reduce((total, player) => total + this.getPlayerScore(player.playerId), 0);
  }
}
