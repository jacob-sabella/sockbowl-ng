import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DomSanitizer } from '@angular/platform-browser';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { environment } from '../../../../environments/environment';

/**
 * Permission sets matching `rbac-model.json`'s composites (AUTH-15). `player`
 * (and `user`, its alias) hold none of the nav-gated permissions.
 */
const PERMISSION_SETS: Record<string, string[]> = {
  player: [],
  author: ['packet:create', 'packet:update', 'packet:delete', 'question:generate', 'taxonomy:manage'],
  moderator: ['user:ban'],
  admin: [
    'packet:create', 'packet:update', 'packet:delete', 'question:generate', 'taxonomy:manage',
    'user:ban', 'admin:access', 'packet:manage-any',
  ],
};

describe('NavbarComponent', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let isAuthenticatedSubject: BehaviorSubject<boolean>;
  let userProfileSubject: BehaviorSubject<any>;
  let originalAuthEnabled: boolean;
  let overlayContainer: OverlayContainer;

  function setUp(permissions: string[]): void {
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    userProfileSubject.next({ sub: 'u1', name: 'Test User', roles: permissions });
    isAuthenticatedSubject.next(true);
    fixture.detectChanges();
  }

  function visibleLabels(): string[] {
    const root: HTMLElement = fixture.nativeElement;
    const buttons = root.querySelectorAll<HTMLElement>('button[aria-label]');
    return Array.from(buttons).map(el => el.getAttribute('aria-label') ?? '');
  }

  /**
   * Opens the mat-menu whose trigger carries this aria-label and returns the
   * aria-labels of the buttons inside its panel. Menu panels render through
   * the CDK overlay (appended to the document, not the fixture), so this
   * reads from the overlay container rather than `fixture.nativeElement`.
   */
  function openMenuLabels(triggerAriaLabel: string): string[] {
    const root: HTMLElement = fixture.nativeElement;
    const trigger = Array.from(root.querySelectorAll<HTMLElement>('button[aria-label]'))
      .find(el => el.getAttribute('aria-label') === triggerAriaLabel);
    if (!trigger) {
      return [];
    }
    trigger.click();
    fixture.detectChanges();
    const panelButtons = overlayContainer.getContainerElement().querySelectorAll<HTMLElement>('button[aria-label]');
    return Array.from(panelButtons).map(el => el.getAttribute('aria-label') ?? '');
  }

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;

    isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
    userProfileSubject = new BehaviorSubject<any>(null);
    authSpy = jasmine.createSpyObj(
      'AuthService',
      ['login', 'logout', 'hasPermission'],
      {
        isAuthenticated$: isAuthenticatedSubject.asObservable(),
        userProfile$: userProfileSubject.asObservable(),
      }
    );
    authSpy.hasPermission.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [NavbarComponent],
      imports: [MatMenuModule, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), url: '/' } },
        { provide: MatIconRegistry, useValue: jasmine.createSpyObj('MatIconRegistry', ['addSvgIconLiteral']) },
        { provide: DomSanitizer, useValue: jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustHtml']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(NavbarComponent);
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
    overlayContainer.ngOnDestroy();
  });

  it('shows no Moderation, Admin menu or Packets link for a player, and an account menu with Profile/Sign out', () => {
    setUp(PERMISSION_SETS['player']);
    const labels = visibleLabels();
    expect(labels).not.toContain('Moderation');
    expect(labels).not.toContain('Admin menu');
    expect(labels).not.toContain('Packet Builder');
    expect(labels).toContain('Account menu, Test User');

    const menuLabels = openMenuLabels('Account menu, Test User');
    expect(menuLabels).toContain('Profile');
    expect(menuLabels).toContain('Sign out');
  });

  it('shows Packets and a standalone Taxonomy link (no admin:access) for an author', () => {
    setUp(PERMISSION_SETS['author']);
    const labels = visibleLabels();
    expect(labels).toContain('Packet Builder');
    expect(labels).toContain('Taxonomy');
    expect(labels).not.toContain('Moderation');
    expect(labels).not.toContain('Admin menu');
  });

  it('shows only Moderation (no Admin menu) for a moderator', () => {
    setUp(PERMISSION_SETS['moderator']);
    const labels = visibleLabels();
    expect(labels).toContain('Moderation');
    expect(labels).not.toContain('Admin menu');
    expect(labels).not.toContain('Packet Builder');
  });

  it('groups Admin, Usage, Bans and Taxonomy under one Admin menu for an admin, alongside Packets', () => {
    setUp(PERMISSION_SETS['admin']);
    const labels = visibleLabels();
    expect(labels).toContain('Admin menu');
    expect(labels).toContain('Packet Builder');
    // Moderation is folded into the Admin menu as "Bans" for admins.
    expect(labels).not.toContain('Moderation');

    const menuLabels = openMenuLabels('Admin menu');
    expect(menuLabels).toContain('Admin');
    expect(menuLabels).toContain('Usage');
    expect(menuLabels).toContain('Bans');
    expect(menuLabels).toContain('Taxonomy');
  });

  it('hides the Admin menu (and its items) without admin:access', () => {
    setUp(PERMISSION_SETS['moderator']);
    const labels = visibleLabels();
    expect(labels).not.toContain('Admin menu');
    // No Admin-menu trigger exists at all, so there is nothing to open.
    expect(openMenuLabels('Admin menu')).toEqual([]);
  });
});
