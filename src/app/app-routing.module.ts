import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import {GameSessionComponent} from "./game/components/game-session/game-session.component";
import {GameCanvasComponent} from "./game/components/game-canvas/game-canvas.component";
import {ProfileComponent} from "./structure/components/profile/profile.component";
import {AdminBansComponent} from "./structure/components/admin-bans/admin-bans.component";
import {AdminHomeComponent} from "./structure/components/admin-home/admin-home.component";
import {AdminUsageComponent} from "./structure/components/admin-usage/admin-usage.component";
import {permissionGuard, authenticatedGuard} from "./core/auth/permission.guard";
import {unsavedChangesGuard} from "./core/guards/unsaved-changes.guard";
import {PacketListComponent} from "./packets/components/packet-list/packet-list.component";
import {PacketBuilderComponent} from "./packets/components/packet-builder/packet-builder.component";
import {AdminTaxonomyComponent} from "./structure/components/admin-taxonomy/admin-taxonomy.component";
import {NotFoundComponent} from "./structure/components/not-found/not-found.component";

const routes: Routes = [
  { path: '', redirectTo: '/game-session', pathMatch: 'full' },
  { path: 'game-session', component: GameSessionComponent, title: 'Join · Sockbowl' },
  { path: 'game', component: GameCanvasComponent, title: 'Play · Sockbowl' },
  { path: 'profile', component: ProfileComponent, canActivate: [authenticatedGuard], title: 'Profile · Sockbowl' },
  { path: 'admin', component: AdminHomeComponent, canActivate: [permissionGuard('admin:access')], title: 'Admin · Sockbowl' },
  { path: 'admin/usage', component: AdminUsageComponent, canActivate: [permissionGuard('admin:access')], title: 'Admin · Usage · Sockbowl' },
  { path: 'admin/bans', component: AdminBansComponent, canActivate: [permissionGuard('user:ban')], title: 'Admin · Bans · Sockbowl' },
  { path: 'admin/taxonomy', component: AdminTaxonomyComponent, canActivate: [permissionGuard('taxonomy:manage')], title: 'Admin · Taxonomy · Sockbowl' },
  { path: 'packets', component: PacketListComponent, canActivate: [permissionGuard('packet:create')], title: 'Packets · Sockbowl' },
  {
    path: 'packets/:id/edit',
    component: PacketBuilderComponent,
    canActivate: [permissionGuard('packet:update')],
    canDeactivate: [unsavedChangesGuard],
    title: 'Edit Packet · Sockbowl'
  },
  // M5 F1-10: the `**` wildcard route. NotFoundComponent is a pre-created
  // stub; S6 owns its final copy, styling and any navigation-history-aware
  // behaviour (see plan §2/§4).
  { path: '**', component: NotFoundComponent, title: 'Not Found · Sockbowl' }

];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
