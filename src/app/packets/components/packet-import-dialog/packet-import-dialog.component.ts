import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { Difficulty, ImportIssue, ImportPacketResult, IssueSeverity } from '../../models/packet-authoring.models';
import { IMPORT_MAX_BYTES } from '../../models/packet-limits';
import { describeGraphqlError, describeGraphqlErrorInline, GraphqlRequestError } from '../../../core/graphql/graphql-errors';
import { limitErrorFrom } from '../../../core/http/limit-errors';

/**
 * Paste-or-upload plaintext import (PB-05, D5), with a dry-run preview
 * before anything is committed (M3 plan 3.3.4):
 *  1. paste text or pick a `.txt` file, plus a name and difficulty;
 *  2. Preview calls `importPacket({dryRun:true})` and shows the parse
 *     result (counts, collapsed tossups/bonuses, issues by line);
 *  3. Import commits (`dryRun:false`); a "skip invalid items" checkbox
 *     appears only once the preview has ERROR-severity issues.
 * On success it navigates straight to the new packet's builder.
 */
@Component({
  selector: 'app-packet-import-dialog',
  templateUrl: './packet-import-dialog.component.html',
  styleUrls: ['./packet-import-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class PacketImportDialogComponent {
  private dialogRef = inject<MatDialogRef<PacketImportDialogComponent>>(MatDialogRef);
  private packetAuthoring = inject(PacketAuthoringService);
  private sockbowlQuestionsService = inject(SockbowlQuestionsService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  readonly maxBytes = IMPORT_MAX_BYTES;
  readonly severityOrder: IssueSeverity[] = ['ERROR', 'WARNING', 'INFO'];

  step: 'input' | 'preview' = 'input';

  text = '';
  name = '';
  difficultyId: string | null = null;
  difficulties: Difficulty[] = [];

  fileError: string | null = null;
  selectedFileName: string | null = null;

  previewing = false;
  importing = false;
  skipInvalid = false;
  result: ImportPacketResult | null = null;
  /** S4-14: an inline message next to the failing action (in addition to the notifyLimit/generic snackbar), so the reason stays visible after the snackbar times out. */
  dialogError: string | null = null;

  /** Stable key for an import issue row (S4-14): `line` + `message`, not `$index`, since a re-preview can reorder or add/remove rows. */
  issueKey(issue: ImportIssue): string {
    return `${issue.severity}:${issue.line ?? ''}:${issue.message}`;
  }

  constructor() {
    this.packetAuthoring.getAllDifficulties().subscribe({
      next: (difficulties) => (this.difficulties = difficulties),
      error: () => {
        // Non-fatal: the difficulty picker is just empty.
      }
    });
  }

  /** UTF-8 byte length of the current text, for the same 512 KiB limit the server enforces. */
  get textByteLength(): number {
    return new TextEncoder().encode(this.text).length;
  }

  get textTooLarge(): boolean {
    return this.textByteLength > this.maxBytes;
  }

  get hasErrorIssues(): boolean {
    return !!this.result?.issues.some((i) => i.severity === 'ERROR');
  }

  get canPreview(): boolean {
    return this.text.trim().length > 0 && !this.textTooLarge && !this.previewing;
  }

  get canImport(): boolean {
    return !!this.result && (!this.hasErrorIssues || this.skipInvalid) && !this.importing;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.fileError = null;

    if (file.size > this.maxBytes) {
      this.fileError = `"${file.name}" is ${formatBytes(file.size)}, over the ${formatBytes(this.maxBytes)} limit.`;
      this.selectedFileName = null;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.text = typeof reader.result === 'string' ? reader.result : '';
      this.selectedFileName = file.name;
      if (!this.name.trim()) {
        this.name = stripExtension(file.name);
      }
    };
    reader.onerror = () => {
      this.fileError = `Could not read "${file.name}".`;
    };
    reader.readAsText(file, 'utf-8');
  }

  issuesBySeverity(severity: IssueSeverity): ImportIssue[] {
    return (this.result?.issues ?? []).filter((i) => i.severity === severity);
  }

  preview(): void {
    if (!this.canPreview) {
      return;
    }
    this.previewing = true;
    this.dialogError = null;
    this.packetAuthoring
      .importPacket({
        text: this.text,
        name: this.name.trim() || null,
        difficultyId: this.difficultyId,
        dryRun: true
      })
      .subscribe({
        next: (result) => {
          this.previewing = false;
          this.result = result;
          this.skipInvalid = false;
          this.step = 'preview';
          if (!this.name.trim() && result.parsed.suggestedName) {
            this.name = result.parsed.suggestedName;
          }
        },
        error: (err) => {
          this.previewing = false;
          this.handleError(err);
        }
      });
  }

  backToInput(): void {
    this.step = 'input';
    this.result = null;
  }

  import(): void {
    if (!this.canImport) {
      return;
    }
    this.importing = true;
    this.dialogError = null;
    this.packetAuthoring
      .importPacket({
        text: this.text,
        name: this.name.trim() || null,
        difficultyId: this.difficultyId,
        dryRun: false,
        skipInvalid: this.skipInvalid
      })
      .subscribe({
        next: (result) => {
          this.importing = false;
          if (result.committed && result.packet) {
            this.snackBar.open('Packet imported', 'Dismiss', { duration: 2500 });
            const packetId = result.packet.id;
            this.dialogRef.close({ packetId });
            this.router.navigate(['/packets', packetId, 'edit']);
          } else {
            // The server declined to commit (e.g. every item was invalid); show the
            // returned issues so the person can go back and fix the source text.
            this.result = result;
            this.step = 'preview';
            this.snackBar.open('Nothing was imported.', 'Dismiss', { duration: 4000 });
          }
        },
        error: (err) => {
          this.importing = false;
          this.handleError(err);
        }
      });
  }

  cancel(): void {
    this.dialogRef.close();
  }

  /**
   * S4-14: RATE_LIMITED/QUOTA_EXCEEDED/BANNED (M4 Q4) are shown once, as the
   * cooldown/quota-aware snackbar, by `GraphqlClientService`'s `notifyLimit`
   * (INT1 single-snackbar rule); here they only get the inline message next
   * to the failing action, so the reason stays visible after the snackbar
   * times out. Anything else keeps the plain snackbar (no inline duplicate —
   * the error is generic enough that the snackbar alone is the answer).
   */
  private handleError(err: unknown): void {
    if (err instanceof GraphqlRequestError && limitErrorFrom(err.classification, err.extensions)) {
      this.dialogError = describeGraphqlErrorInline(err);
      return;
    }
    const message = describeGraphqlError(err);
    if (message) {
      this.snackBar.open(message, 'Dismiss', { duration: 5000 });
    }
  }
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
