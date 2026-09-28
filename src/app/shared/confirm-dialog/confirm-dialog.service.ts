import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import { ConfirmDialogData } from './confirm-dialog.models';

/**
 * Opens {@link ConfirmDialogComponent} and resolves `true`/`false` for the
 * caller's choice. Replaces `window.confirm` everywhere (PB-23): the packet
 * builder and packet list call this instead so the confirmation names the
 * item and can be styled (destructive delete vs. a plain confirmation).
 */
@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
  private dialog = inject(MatDialog);

  confirm(data: ConfirmDialogData): Observable<boolean> {
    return this.dialog
      .open(ConfirmDialogComponent, {
        data,
        width: '440px',
        // M5 F1: focus the dialog surface itself (not a specific control),
        // so screen readers announce the title/message before either button
        // gets focus. 'dialog' is Material's recommended default and avoids
        // the "focus jumps straight to a destructive button" trap the old
        // `cdkFocusInitial` + `autoFocus: false` combination produced.
        autoFocus: 'dialog',
        ariaDescribedBy: 'confirm-dialog-message'
      })
      .afterClosed()
      .pipe(map(result => result === true));
  }
}
