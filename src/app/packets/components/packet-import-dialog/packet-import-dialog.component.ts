import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';

/**
 * Compiling stub (M3 plan 3.3.1). N4 builds out the real 3-step flow (paste
 * or `.txt` upload → dry-run preview via `importPacket({dryRun:true})` →
 * commit) described in plan 3.3.4 (PB-05). Registered here in
 * `app.module.ts` so N4 only has to edit this component's own files.
 */
@Component({
  selector: 'app-packet-import-dialog',
  templateUrl: './packet-import-dialog.component.html',
  styleUrls: ['./packet-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class PacketImportDialogComponent {
  private dialogRef = inject<MatDialogRef<PacketImportDialogComponent>>(MatDialogRef);

  cancel(): void {
    this.dialogRef.close();
  }
}
