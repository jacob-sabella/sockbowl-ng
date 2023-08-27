import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GameSessionComponent} from "./game/components/game-session/game-session.component";

const routes: Routes = [
  { path: 'game-session', component: GameSessionComponent },
  { path: '', redirectTo: '/game-session', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
