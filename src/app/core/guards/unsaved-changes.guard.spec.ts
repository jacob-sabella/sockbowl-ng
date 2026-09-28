import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { ConfirmDialogService } from '../../shared/confirm-dialog/confirm-dialog.service';
import { HasUnsavedChanges, unsavedChangesGuard } from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  let confirmSpy: jasmine.SpyObj<ConfirmDialogService>;

  beforeEach(() => {
    confirmSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    TestBed.configureTestingModule({
      providers: [{ provide: ConfirmDialogService, useValue: confirmSpy }]
    });
  });

  function runGuard(component: HasUnsavedChanges): Observable<boolean> {
    return TestBed.runInInjectionContext(
      () => unsavedChangesGuard(component as any, {} as any, {} as any, {} as any) as Observable<boolean>
    );
  }

  it('lets the user through unconditionally when there are no unsaved changes', (done) => {
    const component: HasUnsavedChanges = { hasUnsavedChanges: () => false };

    runGuard(component).subscribe(result => {
      expect(result).toBeTrue();
      expect(confirmSpy.confirm).not.toHaveBeenCalled();
      done();
    });
  });

  it('blocks navigation when dirty and the user cancels the confirm dialog', (done) => {
    confirmSpy.confirm.and.returnValue(of(false));
    const component: HasUnsavedChanges = { hasUnsavedChanges: () => true };

    runGuard(component).subscribe(result => {
      expect(result).toBeFalse();
      expect(confirmSpy.confirm).toHaveBeenCalled();
      done();
    });
  });

  it('allows navigation when dirty and the user confirms discarding', (done) => {
    confirmSpy.confirm.and.returnValue(of(true));
    const component: HasUnsavedChanges = { hasUnsavedChanges: () => true };

    runGuard(component).subscribe(result => {
      expect(result).toBeTrue();
      done();
    });
  });

  it('asks with a destructive, discard-worded confirmation', (done) => {
    confirmSpy.confirm.and.returnValue(of(true));
    const component: HasUnsavedChanges = { hasUnsavedChanges: () => true };

    runGuard(component).subscribe(() => {
      const data = confirmSpy.confirm.calls.mostRecent().args[0];
      expect(data.destructive).toBeTrue();
      expect(data.confirmText).toContain('Discard');
      done();
    });
  });
});
