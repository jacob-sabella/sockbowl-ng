import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

/**
 * The `**` wildcard route (M5 plan §2/§4 F1: "the not-found route"; S6 owns
 * the surface it lands on and may restyle it, keep-or-change its copy, and
 * add navigation-history-aware behaviour). F1 only needs a route that
 * exists so an unknown URL doesn't fall through to a blank canvas.
 */
@Component({
  selector: 'app-not-found',
  templateUrl: './not-found.component.html',
  styleUrls: ['./not-found.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule]
})
export class NotFoundComponent {
}
