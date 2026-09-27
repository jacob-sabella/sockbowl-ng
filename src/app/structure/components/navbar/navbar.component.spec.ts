import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
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
      providers: [
        { provide: AuthService, useValue: authSpy },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), url: '/' } },
        { provide: MatIconRegistry, useValue: jasmine.createSpyObj('MatIconRegistry', ['addSvgIconLiteral']) },
        { provide: DomSanitizer, useValue: jasmine.createSpyObj('DomSanitizer', ['bypassSecurityTrustHtml']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(NavbarComponent);
  });

  afterEach(() => {
    environment.authEnabled = originalAuthEnabled;
  });

  it('shows no Moderation, Admin or Packets link for a player', () => {
    setUp(PERMISSION_SETS['player']);
    const labels = visibleLabels();
    expect(labels).not.toContain('Moderation');
    expect(labels).not.toContain('Admin');
    expect(labels).not.toContain('Packet Builder');
    expect(labels).toContain('Profile');
  });

  it('shows only Packets for an author', () => {
    setUp(PERMISSION_SETS['author']);
    const labels = visibleLabels();
    expect(labels).toContain('Packet Builder');
    expect(labels).not.toContain('Moderation');
    expect(labels).not.toContain('Admin');
  });

  it('shows only Moderation for a moderator', () => {
    setUp(PERMISSION_SETS['moderator']);
    const labels = visibleLabels();
    expect(labels).toContain('Moderation');
    expect(labels).not.toContain('Admin');
    expect(labels).not.toContain('Packet Builder');
  });

  it('shows Moderation, Admin and Packets for an admin', () => {
    setUp(PERMISSION_SETS['admin']);
    const labels = visibleLabels();
    expect(labels).toContain('Moderation');
    expect(labels).toContain('Admin');
    expect(labels).toContain('Packet Builder');
  });
});
