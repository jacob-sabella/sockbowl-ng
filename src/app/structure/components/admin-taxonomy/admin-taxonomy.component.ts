import { Component, ChangeDetectionStrategy } from '@angular/core';

/**
 * Compiling stub (M3 plan 3.3.1). N6 builds out the real Categories/
 * Subcategories/Difficulties tabs (create, rename with a collision-to-merge
 * offer, merge; no delete — D4) described in plan 3.3.6 (PB-10). Reached
 * only by `taxonomy:manage` holders (`permissionGuard('taxonomy:manage')`
 * on `/admin/taxonomy`), registered here in `app.module.ts` and
 * `app-routing.module.ts` so N6 only has to edit this component's own
 * files.
 */
@Component({
  selector: 'app-admin-taxonomy',
  templateUrl: './admin-taxonomy.component.html',
  styleUrls: ['./admin-taxonomy.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class AdminTaxonomyComponent {}
