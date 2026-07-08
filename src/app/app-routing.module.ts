import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GameSessionComponent} from "./game/components/game-session/game-session.component";
import {GameCanvasComponent} from "./game/components/game-canvas/game-canvas.component";
import {ProfileComponent} from "./structure/components/profile/profile.component";
import {AdminBansComponent} from "./structure/components/admin-bans/admin-bans.component";
import {AuthGuard} from "./core/auth/auth.guard";
import {permissionGuard} from "./core/auth/permission.guard";
import {PacketListComponent} from "./packets/components/packet-list/packet-list.component";
import {PacketBuilderComponent} from "./packets/components/packet-builder/packet-builder.component";

const routes: Routes = [
  { path: '', redirectTo: '/game-session', pathMatch: 'full' },
  { path: 'game-session', component: GameSessionComponent },
  { path: 'game', component: GameCanvasComponent},
  { path: 'profile', component: ProfileComponent, canActivate: [AuthGuard] },
  { path: 'admin/bans', component: AdminBansComponent, canActivate: [permissionGuard('user:ban')] },
  { path: 'packets', component: PacketListComponent, canActivate: [permissionGuard('packet:update')] },
  { path: 'packets/:id/edit', component: PacketBuilderComponent, canActivate: [permissionGuard('packet:update')] }

];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
