import { Component, Input } from '@angular/core';
import { Team, Buzz } from '../../models/sockbowl/sockbowl-interfaces';

@Component({
  selector: 'app-team-list',
  templateUrl: './team-list.component.html',
  styleUrls: ['./team-list.component.scss']
})
export class TeamListComponent {
  @Input() teams!: Team[];
  @Input() currentBuzz!: Buzz;
  @Input() previousBuzzList!: Buzz[];

  isCurrentBuzz(playerId: string): boolean {
    return this.currentBuzz && this.currentBuzz.playerId === playerId;
  }

  hasTeamBuzzed(teamId: string): boolean {
    return this.previousBuzzList.some(buzz => buzz.teamId === teamId);
  }

}
