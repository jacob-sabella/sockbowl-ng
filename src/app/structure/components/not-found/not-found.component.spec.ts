import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { NotFoundComponent } from './not-found.component';

@Component({ template: '', standalone: true })
class BlankComponent {}

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NotFoundComponent, RouterTestingModule.withRoutes([
        { path: '', component: BlankComponent },
        { path: '**', component: BlankComponent },
      ])],
    });
    fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
  });

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a heading and a link back to the app root', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')?.textContent).toContain('not found');
    const link: HTMLAnchorElement | null = el.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/');
  });

  it('does not use 100dvh (so it sizes to the content area, not the full viewport)', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.not-found')).not.toBeNull();
  });

  it('does not render its own <main> landmark (the app shell provides one, S6-05)', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('main')).toBeNull();
  });

  it('echoes the requested path', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/nope/does-not-exist');

    const f = TestBed.createComponent(NotFoundComponent);
    f.detectChanges();

    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('.not-found__path')?.textContent).toContain('/nope/does-not-exist');
  });
});
