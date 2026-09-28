import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DomSanitizer } from '@angular/platform-browser';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
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
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;
  let isAuthenticatedSubject: BehaviorSubject<boolean>;
  let userProfileSubject: BehaviorSubject<any>;
  let sessionEndedSubject: BehaviorSubject<boolean>;
  let originalAuthEnabled: boolean;
  let overlayContainer: OverlayContainer;

  function setUp(permissions: string[]): void {
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    userProfileSubject.next({ sub: 'u1', name: 'Test User', roles: permissions });
    isAuthenticatedSubject.next(true);
    fixture.detectChanges();
  }

  /**
   * S6-05: real destinations (Packets, Moderation, Taxonomy, Admin, Usage,
   * Bans, Profile...) are `<a routerLink>` now, not `<button>` — only the
   * menu triggers, Sign In and Sign out stay `<button>`. This reads both.
   */
  const LABELED_SELECTOR = 'button[aria-label], a[aria-label]';

  function visibleLabels(): string[] {
    const root: HTMLElement = fixture.nativeElement;
    const els = root.querySelectorAll<HTMLElement>(LABELED_SELECTOR);
    return Array.from(els).map(el => el.getAttribute('aria-label') ?? '');
  }

  /**
   * Opens the mat-menu whose trigger carries this aria-label and returns the
   * aria-labels of the elements inside its panel. Menu panels render through
   * the CDK overlay (appended to the document, not the fixture), so this
   * reads from the overlay container rather than `fixture.nativeElement`.
   */
  function openMenuLabels(triggerAriaLabel: string): string[] {
    const root: HTMLElement = fixture.nativeElement;
    const trigger = Array.from(root.querySelectorAll<HTMLElement>(LABELED_SELECTOR))
      .find(el => el.getAttribute('aria-label') === triggerAriaLabel);
    if (!trigger) {
      return [];
    }
    trigger.click();
    fixture.detectChanges();
    const panelItems = overlayContainer.getContainerElement().querySelectorAll<HTMLElement>(LABELED_SELECTOR);
    return Array.from(panelItems).map(el => el.getAttribute('aria-label') ?? '');
  }

  beforeEach(() => {
    originalAuthEnabled = environment.authEnabled;
    environment.authEnabled = true;

    isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
    userProfileSubject = new BehaviorSubject<any>(null);
    sessionEndedSubject = new BehaviorSubject<boolean>(false);
    authSpy = jasmine.createSpyObj(
      'AuthService',
      ['login', 'logout', 'hasPermission'],
      {
        isAuthenticated$: isAuthenticatedSubject.asObservable(),
        userProfile$: userProfileSubject.asObservable(),
        sessionEnded$: sessionEndedSubject.asObservable(),
      }
    );
    authSpy.hasPermission.and.returnValue(false);
    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);

    TestBed.configureTestingModule({
      declarations: [NavbarComponent],
      imports: [MatMenuModule, NoopAnimationsModule],
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
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

  it('gives a long/emoji/RTL display name a full-text title for truncation (S6-11)', () => {
    const longName = '🎉 مستخدم Bartholomew-Maximilian-Fitzgerald-Worthington the Third';
    authSpy.hasPermission.and.callFake((p: string) => PERMISSION_SETS['player'].includes(p));
    userProfileSubject.next({ sub: 'u1', name: longName, roles: PERMISSION_SETS['player'] });
    isAuthenticatedSubject.next(true);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const label = root.querySelector('.navbar__account-trigger .navbar__btn-label');
    expect(label?.getAttribute('title')).toBe(longName);
    expect(label?.textContent).toBe(longName);
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

  describe('mobile fold (S6-03): every role destination also lives in the account menu', () => {
    it('marks every toolbar role destination navbar__role-btn, so CSS can hide it below 640px', () => {
      setUp(PERMISSION_SETS['admin']);
      const root: HTMLElement = fixture.nativeElement;
      const roleButtons = Array.from(root.querySelectorAll<HTMLElement>('.navbar__role-btn'));
      // Admin: Admin-menu trigger (opens a submenu, stays a <button>) + the
      // Packets link (a real destination, an <a> since S6-05) = 2.
      expect(roleButtons.length).toBe(2);
      const tags = roleButtons.map(el => el.tagName).sort();
      expect(tags).toEqual(['A', 'BUTTON']);
    });

    it('folds Packets, Admin, Usage, Bans and Taxonomy into the account menu for an admin', () => {
      setUp(PERMISSION_SETS['admin']);
      const menuLabels = openMenuLabels('Account menu, Test User');
      expect(menuLabels).toContain('Packet Builder');
      expect(menuLabels).toContain('Admin');
      expect(menuLabels).toContain('Usage');
      expect(menuLabels).toContain('Bans');
      expect(menuLabels).toContain('Taxonomy');
      expect(menuLabels).toContain('Profile');
      expect(menuLabels).toContain('Sign out');
    });

    it('folds Packets and the standalone Taxonomy link into the account menu for an author', () => {
      setUp(PERMISSION_SETS['author']);
      const menuLabels = openMenuLabels('Account menu, Test User');
      expect(menuLabels).toContain('Packet Builder');
      expect(menuLabels).toContain('Taxonomy');
      // Author has no admin:access, so no Admin/Usage/Bans entries fold in.
      expect(menuLabels).not.toContain('Admin');
      expect(menuLabels).not.toContain('Usage');
    });

    it('folds Moderation into the account menu for a moderator', () => {
      setUp(PERMISSION_SETS['moderator']);
      const menuLabels = openMenuLabels('Account menu, Test User');
      expect(menuLabels).toContain('Moderation');
      expect(menuLabels).not.toContain('Admin');
    });

    it('folds nothing extra into the account menu for a plain player', () => {
      setUp(PERMISSION_SETS['player']);
      const menuLabels = openMenuLabels('Account menu, Test User');
      expect(menuLabels).toEqual(['Profile', 'Sign out']);
    });
  });

  it('wraps the role destinations in a nav landmark (S6-05)', () => {
    setUp(PERMISSION_SETS['player']);
    const root: HTMLElement = fixture.nativeElement;
    const nav = root.querySelector('nav[aria-label="Main"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('.navbar__account-trigger')).not.toBeNull();
  });

  it('renders the brand as a real link, not a role=button div (S6-05)', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const brand = root.querySelector('.navbar__brand');
    expect(brand?.tagName).toBe('A');
    expect(brand?.getAttribute('role')).toBeNull();
  });

  describe('current destination (S6-05)', () => {
    @Component({ template: '', standalone: true })
    class BlankComponent {}

    beforeEach(async () => {
      TestBed.resetTestingModule();
      environment.authEnabled = true;

      isAuthenticatedSubject = new BehaviorSubject<boolean>(true);
      userProfileSubject = new BehaviorSubject({ sub: 'u1', name: 'Test User', roles: PERMISSION_SETS['admin'] });
      sessionEndedSubject = new BehaviorSubject<boolean>(false);
      authSpy = jasmine.createSpyObj(
        'AuthService',
        ['login', 'logout', 'hasPermission'],
        {
          isAuthenticated$: isAuthenticatedSubject.asObservable(),
          userProfile$: userProfileSubject.asObservable(),
          sessionEnded$: sessionEndedSubject.asObservable(),
        }
      );
      authSpy.hasPermission.and.callFake((p: string) => PERMISSION_SETS['admin'].includes(p));
      confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);

      TestBed.configureTestingModule({
        declarations: [NavbarComponent],
        imports: [
          MatMenuModule,
          NoopAnimationsModule,
          RouterTestingModule.withRoutes([
            { path: 'packets', component: BlankComponent },
            { path: 'admin', component: BlankComponent },
          ]),
        ],
        providers: [
          { provide: AuthService, useValue: authSpy },
          { provide: ConfirmDialogService, useValue: confirmDialogSpy },
          { provide: MatIconRegistry, useValue: jasmine.createSpyObj('MatIconRegistry', ['addSvgIconLiteral']) },
          { provide: DomSanitizer, useValue: jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustHtml']) },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      });

      overlayContainer = TestBed.inject(OverlayContainer);
      fixture = TestBed.createComponent(NavbarComponent);
      fixture.detectChanges();

      const router: Router = TestBed.inject(Router);
      await router.navigate(['/packets']);
      fixture.detectChanges();
    });

    it('marks the current page\'s link with aria-current="page" and the active class', () => {
      const root: HTMLElement = fixture.nativeElement;
      const packetsLink = root.querySelector<HTMLElement>('a[aria-label="Packet Builder"]');
      expect(packetsLink?.getAttribute('aria-current')).toBe('page');
      expect(packetsLink?.classList.contains('navbar__active')).toBeTrue();
    });

    it('leaves every other destination without aria-current or the active class', () => {
      const root: HTMLElement = fixture.nativeElement;
      const adminTrigger = root.querySelector<HTMLElement>('button[aria-label="Admin menu"]');
      expect(adminTrigger?.hasAttribute('aria-current')).toBeFalse();
      expect(adminTrigger?.classList.contains('navbar__active')).toBeFalse();
    });
  });

  it('gives the guest Sign In button an accessible name that carries guest status at every width (S6-15)', () => {
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const btn = root.querySelector('.navbar__signin');
    expect(btn?.getAttribute('aria-label')).toBe('Playing as Guest. Sign In');
    // The visible pill is still there for the widths that have room for it.
    expect(root.querySelector('.navbar__guest-label')?.textContent).toBe('Playing as Guest');
  });

  it('signs out immediately (no confirmation) outside /game', () => {
    setUp(PERMISSION_SETS['player']);
    fixture.componentInstance.logout();
    expect(confirmDialogSpy.confirm).not.toHaveBeenCalled();
    expect(authSpy.logout).toHaveBeenCalled();
  });

  describe('while in /game (S6-06)', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      environment.authEnabled = true;

      isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
      sessionEndedSubject = new BehaviorSubject<boolean>(false);
      authSpy = jasmine.createSpyObj(
        'AuthService',
        ['login', 'logout', 'hasPermission'],
        {
          isAuthenticated$: isAuthenticatedSubject.asObservable(),
          userProfile$: userProfileSubject.asObservable(),
          sessionEnded$: sessionEndedSubject.asObservable(),
        }
      );
      authSpy.hasPermission.and.returnValue(false);
      confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);

      TestBed.configureTestingModule({
        declarations: [NavbarComponent],
        imports: [MatMenuModule, NoopAnimationsModule],
        providers: [
          { provide: AuthService, useValue: authSpy },
          { provide: ConfirmDialogService, useValue: confirmDialogSpy },
          { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), url: '/game' } },
          { provide: MatIconRegistry, useValue: jasmine.createSpyObj('MatIconRegistry', ['addSvgIconLiteral']) },
          { provide: DomSanitizer, useValue: jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustHtml']) },
        ],
        schemas: [NO_ERRORS_SCHEMA],
      });

      overlayContainer = TestBed.inject(OverlayContainer);
      fixture = TestBed.createComponent(NavbarComponent);
    });

    it('shows no Sign In nag for a guest seat that was never signed in', () => {
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.textContent).not.toContain('Playing as Guest');
      expect(visibleLabels().some(l => l.startsWith('Sign in'))).toBeFalse();
    });

    it('keeps a persistent Sign In once the session has ended underneath the user', () => {
      isAuthenticatedSubject.next(false);
      sessionEndedSubject.next(true);
      fixture.detectChanges();
      expect(visibleLabels()).toContain('Sign in (your session ended)');
    });

    it('confirms through the shared dialog before signing out, and only signs out on confirm', () => {
      confirmDialogSpy.confirm.and.returnValue(of(true));
      fixture.componentInstance.logout();
      expect(confirmDialogSpy.confirm).toHaveBeenCalledWith(jasmine.objectContaining({ destructive: true }));
      expect(authSpy.logout).toHaveBeenCalled();
    });

    it('does not sign out when the confirmation is cancelled', () => {
      confirmDialogSpy.confirm.and.returnValue(of(false));
      fixture.componentInstance.logout();
      expect(confirmDialogSpy.confirm).toHaveBeenCalled();
      expect(authSpy.logout).not.toHaveBeenCalled();
    });
  });
});
