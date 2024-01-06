import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { GameSessionComponent } from './game/components/game-session/game-session.component';
import {MatButtonModule} from "@angular/material/button";
import {MatInputModule} from "@angular/material/input";
import {FormsModule} from "@angular/forms";
import {HttpClientModule} from "@angular/common/http";
import {MatIconModule} from "@angular/material/icon";
import { NavbarComponent } from './structure/components/navbar/navbar.component';
import {MatToolbarModule} from "@angular/material/toolbar";
import {MatCardModule} from "@angular/material/card";
import {MatDividerModule} from "@angular/material/divider";
import {MatSelectModule} from "@angular/material/select";
import { GameCanvasComponent } from './game/components/game-canvas/game-canvas.component';
import {MatListModule} from "@angular/material/list";
import {MatSidenavModule} from "@angular/material/sidenav";
import { GameConfigComponent } from './game/components/game-config/game-config.component';
import { GameProctorComponent } from './game/components/game-proctor/game-proctor.component';
import { GameBuzzerComponent } from './game/components/game-buzzer/game-buzzer.component';
import { TeamListComponent } from './game/components/team-list/team-list.component';
import {MatCheckboxModule} from "@angular/material/checkbox";
import { MatchSummaryComponent } from './game/components/match-summary/match-summary.component';
import {MatExpansionModule} from "@angular/material/expansion";

@NgModule({
  declarations: [
    AppComponent,
    GameSessionComponent,
    NavbarComponent,
    GameCanvasComponent,
    GameConfigComponent,
    GameProctorComponent,
    GameBuzzerComponent,
    TeamListComponent,
    MatchSummaryComponent
  ],
    imports: [
        BrowserModule,
        AppRoutingModule,
        BrowserAnimationsModule,
        MatButtonModule,
        MatInputModule,
        FormsModule,
        HttpClientModule,
        MatIconModule,
        MatToolbarModule,
        MatCardModule,
        MatDividerModule,
        MatSelectModule,
        MatListModule,
        MatSidenavModule,
        MatCheckboxModule,
        MatExpansionModule
    ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
