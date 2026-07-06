import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Packet } from '../../models/sockbowl/packet-types.generated';

/**
 * Proctor-only packet preview: renders every tossup and bonus (with answers) in
 * the reading serif so the proctor can look the questions over before starting.
 */
@Component({
  selector: 'app-packet-preview',
  templateUrl: './packet-preview.component.html',
  styleUrls: ['./packet-preview.component.scss'],
  standalone: false,
})
export class PacketPreviewComponent {
  constructor(
    public dialogRef: MatDialogRef<PacketPreviewComponent>,
    @Inject(MAT_DIALOG_DATA) public packet: Packet,
  ) {}

  private byOrder = (a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0);

  get tossups(): any[] {
    return (this.packet?.tossups ?? []).filter(Boolean).slice().sort(this.byOrder);
  }

  get bonuses(): any[] {
    return (this.packet?.bonuses ?? []).filter(Boolean).slice().sort(this.byOrder);
  }

  parts(containsBonus: any): any[] {
    return (containsBonus?.bonus?.bonusParts ?? []).filter(Boolean).slice().sort(this.byOrder);
  }

  close(): void {
    this.dialogRef.close();
  }
}
