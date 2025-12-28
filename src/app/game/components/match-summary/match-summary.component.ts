import {Component, OnInit} from '@angular/core';
import {Observable} from "rxjs";
import {GameSession, Player, Round, Team} from "../../models/sockbowl/sockbowl-interfaces";
import {GameStateService} from "../../services/game-state.service";

@Component({
    selector: 'app-match-summary',
    templateUrl: './match-summary.component.html',
    styleUrls: ['./match-summary.component.scss'],
    standalone: false
})
export class MatchSummaryComponent implements OnInit {

  gameSessionObs!: Observable<GameSession>;
  gameSession!: GameSession;


  constructor(public gameStateService: GameStateService) {
    this.gameSessionObs = this.gameStateService.gameSession$;
  }

  ngOnInit(): void {
    this.gameSessionObs.subscribe(gameSession => {
      this.gameSession = gameSession;
    });
  }


  calculatePlayerScore(player: Player): number {
    let score = 0;
    this.gameSession.currentMatch.previousRounds.forEach(round => {
      round.buzzList.forEach(buzz => {
        if (buzz.playerId === player.playerId && buzz.correct) {
          score += 10; // Add 10 points for each correct answer
        }
      });
    });
    return score;
  }

  calculateTeamBonusScore(teamId: string): number {
    let score = 0;
    this.gameSession.currentMatch.previousRounds.forEach(round => {
      if (round.bonusEligibleTeamId === teamId && round.bonusPartAnswers) {
        score += round.bonusPartAnswers.filter(answer => answer.correct).length * 10;
      }
    });
    return score;
  }

  calculateTeamScore(team: Team): number {
    let teamScore = 0;
    // Sum tossup points
    team.teamPlayers.forEach(player => {
      teamScore += this.calculatePlayerScore(player);
    });
    // Add bonus points
    teamScore += this.calculateTeamBonusScore(team.teamId);
    return teamScore;
  }

  getRoundBonusInfo(round: Round): string {
    if (!round.bonusEligibleTeamId || !round.bonusPartAnswers || round.bonusPartAnswers.length === 0) {
      return '';
    }
    const correctCount = round.bonusPartAnswers.filter(answer => answer.correct).length;
    const totalPoints = correctCount * 10;
    const bonusTeam = this.gameSession.teamList.find(team => team.teamId === round.bonusEligibleTeamId);
    return bonusTeam ? `Bonus: ${bonusTeam.teamName} (${correctCount}/3, ${totalPoints} pts)` : '';
  }

  hasBonus(round: Round): boolean {
    return !!(round.bonusEligibleTeamId && round.bonusPartAnswers && round.bonusPartAnswers.length > 0);
  }
  isCorrectlyAnswered(round: Round): boolean {
    return round.buzzList.some(buzz => buzz.correct);
  }

  isIncorrectlyAnswered(round: Round): boolean {
    return round.buzzList.some(buzz => !buzz.correct) && !this.isCorrectlyAnswered(round);
  }

  isUnanswered(round: Round): boolean {
    return round.buzzList.length === 0;
  }

  getWinningTeamAnnouncement(): string {
    let highestScore = 0;
    let winningTeams: Team[] = [];

    // Calculate scores for each team and find the highest score
    this.gameSession.teamList.forEach(team => {
      const score = this.calculateTeamScore(team);
      if (score > highestScore) {
        highestScore = score;
        winningTeams = [team];
      } else if (score === highestScore) {
        winningTeams.push(team);
      }
    });

    // Determine the announcement message based on the winning teams
    if (winningTeams.length > 1) {
      // Handle a tie
      return "It's a Tie!";
    } else if (winningTeams.length === 1) {
      // Announce the winning team
      return `${winningTeams[0].teamName} Wins!`;
    } else {
      // In case no team has scored
      return "No team has scored.";
    }
  }

  getCorrectAnswerPlayerWithTeam(round: Round): string {
    const correctBuzz = round.buzzList.find(buzz => buzz.correct);
    if (correctBuzz) {
      const correctPlayer = this.gameSession.playerList.find(player => player.playerId === correctBuzz.playerId);
      const correctTeam = this.gameSession.teamList.find(team => team.teamId === correctBuzz.teamId);
      return correctPlayer && correctTeam ? `${correctPlayer.name} (${correctTeam.teamName})` : 'No correct answer';
    }
    return 'No correct answer';
  }

  getTeamAnswerInfo(round: Round): string {
    const correctBuzz = round.buzzList.find(buzz => buzz.correct);
    if (correctBuzz) {
      const correctTeam = this.gameSession.teamList.find(team => team.teamId === correctBuzz.teamId);
      return correctTeam ? `Answered by: ${correctTeam.teamName}` : '';
    }
    return '';
  }

  endMatch(): void {
    this.gameStateService.endMatch();
  }
}
