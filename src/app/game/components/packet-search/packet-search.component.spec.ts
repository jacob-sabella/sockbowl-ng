import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PacketSearchComponent } from './packet-search.component';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { OpenAiModelService } from '../../services/openai-model.service';
import { AuthService } from '../../../core/auth/auth.service';

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => {} } },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: SockbowlQuestionsService, useValue: {
            getBankTaxonomyCounts: () => of({ categories: {}, subcategories: {}, alternates: {} }),
            countBankAvailable: () => of({ tossups: 0, bonuses: 0 }),
        } },
        { provide: OpenAiModelService, useValue: {} },
        { provide: AuthService, useValue: { hasPermission: () => false, isAuthenticated: () => false } },
      ],
      // Template uses Angular Material elements not declared in this unit test.
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(PacketSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
