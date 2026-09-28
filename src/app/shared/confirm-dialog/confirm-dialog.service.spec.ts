import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ConfirmDialogService } from './confirm-dialog.service';
import { ConfirmDialogComponent } from './confirm-dialog.component';

describe('ConfirmDialogService', () => {
  let service: ConfirmDialogService;
  let dialog: jasmine.SpyObj<MatDialog>;

  beforeEach(() => {
    const dialogRef = jasmine.createSpyObj<MatDialogRef<ConfirmDialogComponent, boolean>>('MatDialogRef', ['afterClosed']);
    dialogRef.afterClosed.and.returnValue(of(true));

    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue(dialogRef);

    TestBed.configureTestingModule({
      providers: [ConfirmDialogService, { provide: MatDialog, useValue: dialog }]
    });
    service = TestBed.inject(ConfirmDialogService);
  });

  it('opens the dialog focused on the dialog surface, not a specific button', () => {
    service.confirm({ title: 'Discard?', message: 'You have unsaved changes.' }).subscribe();

    expect(dialog.open).toHaveBeenCalledTimes(1);
    const [component, config] = dialog.open.calls.mostRecent().args;
    expect(component).toBe(ConfirmDialogComponent);
    expect(config?.autoFocus).toBe('dialog');
  });

  it('points aria-describedby at the message element', () => {
    service.confirm({ title: 'Discard?', message: 'You have unsaved changes.' }).subscribe();

    const config = dialog.open.calls.mostRecent().args[1];
    expect(config?.ariaDescribedBy).toBe('confirm-dialog-message');
  });

  it('resolves true only when the dialog closes with true', () => {
    let result: boolean | undefined;
    service.confirm({ title: 'Discard?', message: 'You have unsaved changes.' }).subscribe(r => (result = r));

    expect(result).toBeTrue();
  });
});
