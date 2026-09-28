import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogData } from './confirm-dialog.models';

describe('ConfirmDialogComponent', () => {
  let fixture: ComponentFixture<ConfirmDialogComponent>;
  let component: ConfirmDialogComponent;
  let dialogRef: jasmine.SpyObj<MatDialogRef<ConfirmDialogComponent, boolean>>;

  function configure(data: ConfirmDialogData): void {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      declarations: [ConfirmDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    });

    fixture = TestBed.createComponent(ConfirmDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('renders the title and message from the injected data', () => {
    configure({ title: 'Discard unsaved changes?', message: 'You have unsaved changes.' });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Discard unsaved changes?');
    expect(el.textContent).toContain('You have unsaved changes.');
  });

  it('falls back to default button text when none is supplied', () => {
    configure({ title: 'Remove tossup 7?', message: 'This cannot be undone.' });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Cancel');
    expect(el.textContent).toContain('Confirm');
  });

  it('uses custom confirm/cancel text when supplied', () => {
    configure({
      title: 'Discard unsaved changes?',
      message: 'Leave without saving?',
      confirmText: 'Discard changes',
      cancelText: 'Stay'
    });
    const el = fixture.nativeElement as HTMLElement;

    expect(el.textContent).toContain('Discard changes');
    expect(el.textContent).toContain('Stay');
  });

  it('close(true) closes the dialog ref with true', () => {
    configure({ title: 'Delete packet "Foo"?', message: 'This cannot be undone.', destructive: true });
    component.close(true);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('close(false) closes the dialog ref with false', () => {
    configure({ title: 'Delete packet "Foo"?', message: 'This cannot be undone.' });
    component.close(false);
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('clicking Cancel closes with false', () => {
    configure({ title: 'Remove this bonus part?', message: 'This cannot be undone.' });
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });

  it('clicking the confirm button closes with true', () => {
    configure({ title: 'Remove this bonus part?', message: 'This cannot be undone.', destructive: true });
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });
});
