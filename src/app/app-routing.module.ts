import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GameSessionComponent} from "./game/components/game-session/game-session.component";
import {GameCanvasComponent} from "./game/components/game-canvas/game-canvas.component";
import {ProfileComponent} from "./structure/components/profile/profile.component";
import {AuthGuard} from "./core/auth/auth.guard";

const routes: Routes = [
  { path: '', redirectTo: '/game-session', pathMatch: 'full' },
  { path: 'game-session', component: GameSessionComponent },
  { path: 'game', component: GameCanvasComponent},
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] }

];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
