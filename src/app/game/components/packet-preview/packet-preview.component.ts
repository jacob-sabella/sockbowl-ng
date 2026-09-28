import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Packet } from '../../models/sockbowl/packet-types.generated';

/**
 * Proctor-only packet preview dialog: dialog chrome (title, close button)
 * around the shared {@link PacketReadingViewComponent}, which renders every
 * tossup and bonus (with answers) in the reading serif so the proctor can
 * look the questions over before starting. The reading view itself moved to
 * `shared/packet-reading-view` (M3 plan 3.3.1) so the builder's preview tab
 * (PB-07) can reuse it without a dialog.
 */
@Component({
  selector: 'app-packet-preview',
  templateUrl: './packet-preview.component.html',
  styleUrls: ['./packet-preview.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class PacketPreviewComponent {
  dialogRef = inject<MatDialogRef<PacketPreviewComponent>>(MatDialogRef);
  packet = inject<Packet>(MAT_DIALOG_DATA);

  get tossupCount(): number {
    return (this.packet?.tossups ?? []).filter(Boolean).length;
  }

  get bonusCount(): number {
    return (this.packet?.bonuses ?? []).filter(Boolean).length;
  }

  close(): void {
    this.dialogRef.close();
  }
}
