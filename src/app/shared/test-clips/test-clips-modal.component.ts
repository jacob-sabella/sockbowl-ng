import { Component, EventEmitter, HostListener, OnInit, Output } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface Clip {
  title: string;
  spec: string;
  file: string;
  ok: boolean;
}

interface ClipGroup {
  spec: string;
  items: Clip[];
}

/**
 * Secret test gallery: plays the per-test Playwright recordings packaged into the
 * build (see scripts/build-clips.mjs) as a browsable gallery of the UI in action.
 * Opened by typing the word "clips" anywhere in the app (see AppComponent).
 */
@Component({
  selector: 'app-test-clips-modal',
  templateUrl: './test-clips-modal.component.html',
  styleUrls: ['./test-clips-modal.component.scss'],
  standalone: false
})
export class TestClipsModalComponent implements OnInit {
  @Output() closed = new EventEmitter<void>();

  clips: Clip[] | null = null;
  groups: ClipGroup[] = [];
  selected: Clip | null = null;
  error = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<{ clips: Clip[] }>('/assets/test-clips/manifest.json').subscribe({
      next: (data) => {
        this.clips = data?.clips ?? [];
        this.groups = this.groupBySpec(this.clips);
        this.selected = this.clips[0] ?? null;
      },
      error: () => { this.error = true; }
    });
  }

  select(clip: Clip): void {
    this.selected = clip;
  }

  close(): void {
    this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  /** Short spec label for a group heading (drops the .spec.ts suffix). */
  specLabel(spec: string): string {
    return spec.replace(/\.spec\.ts$/, '');
  }

  private groupBySpec(clips: Clip[]): ClipGroup[] {
    const map = new Map<string, Clip[]>();
    for (const c of clips) {
      const list = map.get(c.spec) ?? [];
      list.push(c);
      map.set(c.spec, list);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([spec, items]) => ({ spec, items }));
  }
}
