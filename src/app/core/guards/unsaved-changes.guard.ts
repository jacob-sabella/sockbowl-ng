import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { Observable, of } from 'rxjs';
import { ConfirmDialogService } from '../../shared/confirm-dialog/confirm-dialog.service';

/**
 * Implemented by any routed component that can leave dirty drafts behind
 * (the packet builder, D6). Lets {@link unsavedChangesGuard} ask before
 * navigating away.
 */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * `canDeactivate` guard for `/packets/:id/edit` (M3 plan 3.3.1/3.3.2, D6,
 * fixes PB-03). Lets the component through unconditionally when it has no
 * unsaved changes; otherwise confirms with {@link ConfirmDialogService}
 * ("Discard N unsaved changes?") and only lets the user through on "Discard".
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component): Observable<boolean> => {
  if (!component.hasUnsavedChanges()) {
    return of(true);
  }
  const confirmDialog = inject(ConfirmDialogService);
  return confirmDialog.confirm({
    title: 'Discard unsaved changes?',
    message: 'You have unsaved changes on this packet. Leave without saving them?',
    confirmText: 'Discard changes',
    cancelText: 'Stay',
    destructive: true
  });
};
