import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { EditQuotaDialogComponent, EditQuotaDialogData } from './edit-quota-dialog.component';

describe('EditQuotaDialogComponent (S5-05)', () => {
  let fixture: ComponentFixture<EditQuotaDialogComponent>;
  let component: EditQuotaDialogComponent;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<EditQuotaDialogComponent>>;

  function configure(data: EditQuotaDialogData): void {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    // Some specs (e.g. the seeding test below) call configure() more than once
    // to exercise the component against two different dialog data values.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EditQuotaDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });

    fixture = TestBed.createComponent(EditQuotaDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('seeds the limit from the current value, and "unlimited" from -1', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    expect(component.limitValue).toBe(20);
    expect(component.unlimited).toBeFalse();

    configure({ metric: 'packets-owned', currentLimit: -1, overridden: false });
    expect(component.unlimited).toBeTrue();
  });

  it('an emptied field no longer saves a limit of 0 (S5-05): Save is disabled and the service is never called', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.limitValue = null;

    expect(component.limitInvalid).toBeTrue();

    component.save();

    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('a negative limit is invalid and is never saved', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.limitValue = -5;

    expect(component.limitInvalid).toBeTrue();
    component.save();
    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('a non-integer limit is invalid and is never saved', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.limitValue = 3.5;

    expect(component.limitInvalid).toBeTrue();
    component.save();
    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('checking Unlimited makes any limitValue irrelevant to validity', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.limitValue = null;
    component.unlimited = true;

    expect(component.limitInvalid).toBeFalse();

    component.save();

    expect(dialogRefSpy.close).toHaveBeenCalledWith({ limit: -1 });
  });

  it('a valid whole-number limit saves exactly that number', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.limitValue = 0;

    component.save();

    expect(dialogRefSpy.close).toHaveBeenCalledWith({ limit: 0 });
  });

  it('resetToDefault closes with limit: null regardless of the current field value', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: true });
    component.limitValue = null;

    component.resetToDefault();

    expect(dialogRefSpy.close).toHaveBeenCalledWith({ limit: null });
  });

  it('cancel() closes with no result', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });
    component.cancel();
    expect(dialogRefSpy.close).toHaveBeenCalledWith();
  });

  it('a second save() call is a no-op once submitting (S5-16 double-submit guard)', () => {
    configure({ metric: 'ai.generations', currentLimit: 20, overridden: false });

    component.save();
    dialogRefSpy.close.calls.reset();
    component.save();

    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });
});
