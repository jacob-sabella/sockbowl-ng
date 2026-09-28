import {GameSinglePlayerComponent} from './game/components/game-single-player/game-single-player.component';
import {GameAutoProctorComponent} from './game/components/game-auto-proctor/game-auto-proctor.component';
import { NgModule, isDevMode } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ServiceWorkerModule } from '@angular/service-worker';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { TestClipsModalComponent } from './shared/test-clips/test-clips-modal.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { GameSessionComponent } from './game/components/game-session/game-session.component';
import {MatButtonModule} from "@angular/material/button";
import {MatInputModule} from "@angular/material/input";
import {FormsModule} from "@angular/forms";
import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi, withXhr } from "@angular/common/http";
import {MatIconModule} from "@angular/material/icon";
import { OAuthModule } from 'angular-oauth2-oidc';
import { AuthInterceptor } from './core/auth/auth.interceptor';
import { RateLimitInterceptor } from './core/http/rate-limit.interceptor';
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
import { GameSpectatorComponent } from './game/components/game-spectator/game-spectator.component';
import { TeamListComponent } from './game/components/team-list/team-list.component';
import {MatCheckboxModule} from "@angular/material/checkbox";
import {MatSlideToggleModule} from "@angular/material/slide-toggle";
import { MatchSummaryComponent } from './game/components/match-summary/match-summary.component';
import {MatExpansionModule} from "@angular/material/expansion";
import { PacketSearchComponent } from './game/components/packet-search/packet-search.component';
import { PacketPreviewComponent } from './game/components/packet-preview/packet-preview.component';
import {MatDialogModule} from "@angular/material/dialog";
import {MatBadgeModule} from "@angular/material/badge";
import {MatChipsModule} from "@angular/material/chips";
import {MatSnackBarModule} from "@angular/material/snack-bar";
import {MatTooltipModule} from "@angular/material/tooltip";
import {MatProgressSpinnerModule} from "@angular/material/progress-spinner";
import {MatProgressBarModule} from "@angular/material/progress-bar";
import {MatTabsModule} from "@angular/material/tabs";
import {MatAutocompleteModule} from "@angular/material/autocomplete";
import {MatMenuModule} from "@angular/material/menu";
import {MatPaginatorModule} from "@angular/material/paginator";
import { ProfileComponent } from './structure/components/profile/profile.component';
import { ThemeSelectorComponent } from './structure/components/theme-selector/theme-selector.component';
import { AdminBansComponent } from './structure/components/admin-bans/admin-bans.component';
import { AdminHomeComponent } from './structure/components/admin-home/admin-home.component';
import { PacketListComponent } from './packets/components/packet-list/packet-list.component';
import { PacketBuilderComponent } from './packets/components/packet-builder/packet-builder.component';
import { StompErrorBannerComponent } from './game/components/stomp-error-banner/stomp-error-banner.component';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ConfirmDialogComponent } from './shared/confirm-dialog/confirm-dialog.component';
import { PacketReadingViewComponent } from './shared/packet-reading-view/packet-reading-view.component';
import { AiKeyPickerComponent } from './shared/ai-key/ai-key-picker.component';
import { PacketImportDialogComponent } from './packets/components/packet-import-dialog/packet-import-dialog.component';
import { AdminTaxonomyComponent } from './structure/components/admin-taxonomy/admin-taxonomy.component';

@NgModule({ declarations: [
        AppComponent,
        GameSessionComponent,
        NavbarComponent,
        GameCanvasComponent,
        GameConfigComponent,
        GameProctorComponent,
        GameBuzzerComponent,
    GameSinglePlayerComponent,
    GameAutoProctorComponent,
        GameSpectatorComponent,
        TeamListComponent,
        MatchSummaryComponent,
        PacketSearchComponent,
        PacketPreviewComponent,
        ProfileComponent,
        ThemeSelectorComponent,
        AdminBansComponent,
        AdminHomeComponent,
        PacketListComponent,
        PacketBuilderComponent,
        TestClipsModalComponent,
        ConfirmDialogComponent,
        PacketReadingViewComponent,
        AiKeyPickerComponent,
        PacketImportDialogComponent,
        AdminTaxonomyComponent
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        BrowserAnimationsModule,
        MatButtonModule,
        MatInputModule,
        FormsModule,
        MatIconModule,
        MatToolbarModule,
        MatCardModule,
        MatDividerModule,
        MatSelectModule,
        MatListModule,
        MatSidenavModule,
        MatCheckboxModule,
        MatSlideToggleModule,
        MatExpansionModule,
        MatDialogModule,
        MatBadgeModule,
        MatChipsModule,
        MatSnackBarModule,
        MatTooltipModule,
        MatProgressSpinnerModule,
        MatProgressBarModule,
        MatTabsModule,
        MatAutocompleteModule,
        MatMenuModule,
        MatPaginatorModule,
        DragDropModule,
        StompErrorBannerComponent,
        // OAuth2/OIDC Module
        OAuthModule.forRoot(),
        // PWA service worker — enabled only in production builds. Registers
        // after the app stabilizes so it never delays first paint.
        ServiceWorkerModule.register('ngsw-worker.js', {
            enabled: !isDevMode(),
            registrationStrategy: 'registerWhenStable:30000'
        })], providers: [
        // HTTP Interceptor for adding JWT tokens
        {
            provide: HTTP_INTERCEPTORS,
            useClass: AuthInterceptor,
            multi: true
        },
        // Registered after AuthInterceptor (M4-UI-01): it sees 429/503 first
        // on the way back up, and leaves 401/403 handling to AuthInterceptor.
        {
            provide: HTTP_INTERCEPTORS,
            useClass: RateLimitInterceptor,
            multi: true
        },
        provideHttpClient(withXhr(), withInterceptorsFromDi())
    ] })
export class AppModule { }
