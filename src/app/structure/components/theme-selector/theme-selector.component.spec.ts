import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { MatMenuModule } from '@angular/material/menu';
import { OverlayContainer } from '@angular/cdk/overlay';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

import { ThemeSelectorComponent } from './theme-selector.component';
import { ThemeService, Theme } from '../../../core/services/theme.service';

/**
 * S6-09: the theme menu's semantics (role=menuitemradio + aria-checked, and
 * the trigger's current-theme description). S6-08 (the active row's visual
 * mark) predates this spec file.
 */
describe('ThemeSelectorComponent', () => {
  let fixture: ComponentFixture<ThemeSelectorComponent>;
  let themeSpy: jasmine.SpyObj<ThemeService>;
  let themeSubject: BehaviorSubject<Theme>;
  let overlayContainer: OverlayContainer;

  function openMenu(): HTMLElement {
    const root: HTMLElement = fixture.nativeElement;
    const trigger = root.querySelector<HTMLElement>('.theme-toggle');
    trigger?.click();
    fixture.detectChanges();
    return overlayContainer.getContainerElement();
  }

  beforeEach(() => {
    themeSubject = new BehaviorSubject<Theme>('dark');
    themeSpy = jasmine.createSpyObj('ThemeService', ['setTheme'], {
      theme$: themeSubject.asObservable(),
    });

    TestBed.configureTestingModule({
      declarations: [ThemeSelectorComponent],
      imports: [MatMenuModule, NoopAnimationsModule],
      providers: [{ provide: ThemeService, useValue: themeSpy }],
      schemas: [NO_ERRORS_SCHEMA],
    });

    overlayContainer = TestBed.inject(OverlayContainer);
    fixture = TestBed.createComponent(ThemeSelectorComponent);
    fixture.detectChanges();
  });

  afterEach(() => overlayContainer.ngOnDestroy());

  it('keeps the trigger accessible name "Theme selector" (tests/theme.spec.ts, e2e/polish/scenarios/s6.ts)', () => {
    const root: HTMLElement = fixture.nativeElement;
    const trigger = root.querySelector('.theme-toggle');
    expect(trigger?.getAttribute('aria-label')).toBe('Theme selector');
  });

  it("describes the trigger with the current theme, without changing its name (S6-09)", () => {
    const root: HTMLElement = fixture.nativeElement;
    const trigger = root.querySelector('.theme-toggle');
    const describedbyId = trigger?.getAttribute('aria-describedby');
    expect(describedbyId).toBeTruthy();
    const description = root.querySelector(`#${describedbyId}`);
    expect(description?.textContent).toContain('Dark');
  });

  it('updates the description text when the theme changes', () => {
    themeSubject.next('nord');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const describedbyId = root.querySelector('.theme-toggle')?.getAttribute('aria-describedby');
    expect(root.querySelector(`#${describedbyId}`)?.textContent).toContain('Nord');
  });

  it('renders every theme option with role=menuitemradio and aria-checked on the active one only', () => {
    const panel = openMenu();
    const options = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitemradio"]'));
    expect(options.length).toBeGreaterThan(0);

    const checked = options.filter(el => el.getAttribute('aria-checked') === 'true');
    expect(checked.length).toBe(1);
    expect(checked[0].textContent).toContain('Dark');

    const uncheckedCount = options.filter(el => el.getAttribute('aria-checked') === 'false').length;
    expect(uncheckedCount).toBe(options.length - 1);
  });

  it('calls ThemeService.setTheme with the clicked option\'s value', () => {
    const panel = openMenu();
    const lightOption = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
      .find(el => el.textContent?.includes('Light'));
    lightOption?.click();
    expect(themeSpy.setTheme).toHaveBeenCalledWith('light');
  });
});
