import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;
  let authSpy: jasmine.SpyObj<AuthService>;

  function configure(permissions: string[]): void {
    authSpy = jasmine.createSpyObj('AuthService', ['hasPermission', 'isAuthenticated']);
    authSpy.hasPermission.and.callFake((p: string) => permissions.includes(p));
    authSpy.isAuthenticated.and.returnValue(false);

    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => { /* noop test double */ } } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => { /* noop test double */ } } },
        { provide: SockbowlQuestionsService, useValue: {
            getBankTaxonomyCounts: () => of({ categories: {}, subcategories: {}, alternates: {} }),
            countBankAvailable: () => of({ tossups: 0, bonuses: 0 }),
        } },
        { provide: OpenAiModelService, useValue: {} },
        { provide: AuthService, useValue: authSpy },
      ],
      // Template uses Angular Material elements not declared in this unit test.
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(PacketSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create', () => {
    configure([]);
    expect(component).toBeTruthy();
  });

  it('hides the AI generate tab without question:generate', () => {
    configure([]);
    const aiTab = (fixture.nativeElement as HTMLElement).querySelector('.generate-container');
    expect(aiTab).toBeNull();
  });

  it('shows the AI generate tab with question:generate', () => {
    configure(['question:generate']);
    const aiTab = (fixture.nativeElement as HTMLElement).querySelector('.generate-container');
    expect(aiTab).not.toBeNull();
  });

  it('keeps the local-bank Generate tab available to a guest with no permissions (D15 preserves guest UX)', () => {
    configure([]);
    const bankTab = (fixture.nativeElement as HTMLElement).querySelector('.qb-content');
    expect(bankTab).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Build a packet from the question bank');
  });

  describe('M4-UI-01 rate-limit cooldowns', () => {
    it('disables the AI Generate button while the ai-generate policy cools down', () => {
      configure(['question:generate']);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.generateTopic = 'Topic';
      component.apiKey = 'sk-test';
      component.selectedModel = 'gpt-5';
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.generate-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('ai-generate', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();

      rateLimitState.clearCooldown('ai-generate');
      fixture.detectChanges();
      expect(button.disabled).toBeFalse();
    });

    it('disables the bank Import button while the import policy cools down', () => {
      configure([]);
      const rateLimitState = TestBed.inject(RateLimitStateService);
      component.availTossups = 5;
      fixture.detectChanges();

      const button = (fixture.nativeElement as HTMLElement).querySelector('.qb-import-btn') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();

      rateLimitState.setCooldown('import', 5);
      fixture.detectChanges();
      expect(button.disabled).toBeTrue();
    });
  });
});
