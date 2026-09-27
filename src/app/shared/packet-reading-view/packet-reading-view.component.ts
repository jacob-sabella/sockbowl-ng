import { Component, ChangeDetectionStrategy, Input } from '@angular/core';
import { Packet } from '../../game/models/sockbowl/packet-types.generated';

/**
 * Read-only rendering of a packet's tossups and bonuses (with answers) in
 * the reading serif. Moved out of `game/components/packet-preview` (M3 plan
 * 3.3.1) so it can be reused both as the proctor-only dialog body
 * ({@link PacketPreviewComponent}, a thin wrapper around this component) and
 * inline as the builder's "Preview" tab (PB-07, N3).
 */
@Component({
  selector: 'app-packet-reading-view',
  templateUrl: './packet-reading-view.component.html',
  styleUrls: ['./packet-reading-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class PacketReadingViewComponent {
  @Input() packet: Packet | null = null;

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
}
