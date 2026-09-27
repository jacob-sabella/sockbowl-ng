import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AdminHomeComponent } from './admin-home.component';
import { AuthService } from '../../../core/auth/auth.service';

describe('AdminHomeComponent', () => {
  let fixture: ComponentFixture<AdminHomeComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;

  function setUp(hasUserBan: boolean): void {
    authSpy.hasPermission.and.callFake((p: string) => p === 'user:ban' && hasUserBan);
    fixture.detectChanges();
  }

  beforeEach(() => {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission']);
    authSpy.hasPermission.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [AdminHomeComponent],
      providers: [{ provide: AuthService, useValue: authSpy }],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(AdminHomeComponent);
  });

  it('creates and shows the Admin title', () => {
    setUp(false);
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.admin-home__title')?.textContent).toContain('Admin');
  });

  it('shows the Usage placeholder card regardless of permissions (M4-AD-02 fills it in)', () => {
    setUp(false);
    const root: HTMLElement = fixture.nativeElement;
    const titles = Array.from(root.querySelectorAll('.admin-home__card-title')).map(el => el.textContent?.trim());
    expect(titles).toContain('Usage');
    expect(root.querySelector('.admin-home__card--disabled')?.textContent).toContain('Coming soon');
  });

  it('hides the Bans card for an admin without user:ban', () => {
    setUp(false);
    const root: HTMLElement = fixture.nativeElement;
    const titles = Array.from(root.querySelectorAll('.admin-home__card-title')).map(el => el.textContent?.trim());
    expect(titles).not.toContain('Bans');
    expect(root.querySelector('a[aria-label="Open ban management"]')).toBeNull();
  });

  it('shows a Bans link for an admin holding user:ban', () => {
    setUp(true);
    const root: HTMLElement = fixture.nativeElement;
    const titles = Array.from(root.querySelectorAll('.admin-home__card-title')).map(el => el.textContent?.trim());
    expect(titles).toContain('Bans');
    expect(root.querySelector('a[aria-label="Open ban management"]')).not.toBeNull();
  });
});
