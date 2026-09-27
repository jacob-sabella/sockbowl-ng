import { Component, OnInit, ChangeDetectionStrategy, HostListener, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { Observable, forkJoin, of, throwError } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import {
  BonusElement,
  BonusPartElement,
  Packet,
  TossupElement
} from '../../../game/models/sockbowl/packet-types.generated';
import {
  AuthoringPacket,
  Category,
  Difficulty,
  PacketValidation,
  PacketVisibility,
  Subcategory
} from '../../models/packet-authoring.models';
import { PACKET_LIMITS } from '../../models/packet-limits';
import { AuthService } from '../../../core/auth/auth.service';
import { describeGraphqlError, GraphqlRequestError } from '../../../core/graphql/graphql-errors';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { PendingPacketService } from '../../../game/services/pending-packet.service';
import { DraftEntitySource, PacketDraftStore } from './packet-draft-store';

interface TossupDraft {
  question: string;
  answer: string;
  subcategoryId: string | null;
}

interface BonusDraft {
  preamble: string;
  subcategoryId: string | null;
}

interface BonusPartDraft {
  question: string;
  answer: string;
}

interface NewBonusPartDraft {
  question: string;
  answer: string;
}

interface NewBonusDraft {
  preamble: string;
  subcategoryId: string | null;
  parts: NewBonusPartDraft[];
}

interface SubcategoryGroup {
  category: string;
  subs: Subcategory[];
}

type SaveWorkItem =
  | { kind: 'tossup'; id: string }
  | { kind: 'bonus'; id: string }
  | { kind: 'part'; id: string; bonusId: string };

/**
 * Packet builder / editor (M3 plan 3.3.2). Loads the full packet graph, the
 * difficulty list, and the subcategory taxonomy on init. Every tossup,
 * bonus, and bonus part is edited through a {@link PacketDraftStore} draft
 * (dirty/original/value), so an unsaved edit on one card survives a refetch
 * triggered by saving a *different* card (PB-02). "Save all" saves every
 * dirty draft in packet order and stops at the first error. The packet's
 * `version` is sent as `expectedVersion` on every content mutation
 * (optimistic locking, PB-18); a `CONFLICT` response opens a persistent
 * "changed elsewhere" banner rather than a snackbar.
 */
@Component({
  selector: 'app-packet-builder',
  templateUrl: './packet-builder.component.html',
  styleUrls: ['./packet-builder.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class PacketBuilderComponent implements OnInit, HasUnsavedChanges {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private sockbowlQuestionsService = inject(SockbowlQuestionsService);
  private packetAuthoring = inject(PacketAuthoringService);
  private snackBar = inject(MatSnackBar);
  private confirmDialog = inject(ConfirmDialogService);
  private pendingPacket = inject(PendingPacketService);
  auth = inject(AuthService);

  limits = PACKET_LIMITS;

  packetId = '';
  packet: AuthoringPacket | null = null;
  loading = true;

  /** The packet's last-known-good version, sent as `expectedVersion` on every content mutation (PB-18). */
  packetVersion = 0;

  /** Set when a mutation returns `CONFLICT`: shown as a persistent banner instead of a snackbar. */
  conflictBanner = false;
  /** Entity ids that were dirty at the moment of a conflict reload, so their cards can say "based on an older version". */
  staleDraftIds = new Set<string>();

  savingAll = false;

  /** Preview tab toggle (PB-07): swaps the editor cards for {@link PacketReadingViewComponent}. */
  showPreview = false;

  difficulties: Difficulty[] = [];
  categories: Category[] = [];
  allSubcategories: Subcategory[] = [];
  subcategoryGroups: SubcategoryGroup[] = [];

  // Header: inline name editing.
  editingName = false;
  nameDraft = '';
  savingName = false;

  // Per-card drafts, one store per entity kind (M3 plan 3.3.2).
  tossupDraftStore = new PacketDraftStore<TossupDraft>();
  bonusDraftStore = new PacketDraftStore<BonusDraft>();
  bonusPartDraftStore = new PacketDraftStore<BonusPartDraft>();

  newTossupOpen = false;
  newTossupDraft: TossupDraft = { question: '', answer: '', subcategoryId: null };
  addingTossup = false;

  newBonusOpen = false;
  addingBonus = false;
  newBonusDraft: NewBonusDraft = this.freshNewBonusDraft();
  justAddedBonusId: string | null = null;

  newPartOpen: Record<string, boolean> = {};
  newPartDrafts: Record<string, NewBonusPartDraft> = {};

  // AI-assist form. apiKey/model are owned by the embedded AiKeyPickerComponent
  // (PB-08, N5's shared/ai-key), which seeds them from AiKeyService on init.
  genOpen = false;
  genSubmitting = false;
  genDraft = { topic: '', additionalContext: '', subcategoryId: null as string | null, apiKey: '', model: '' };

  // Inline "create new subcategory" affordance, shared by every subcategory picker.
  taxonomyFormOpen = false;
  taxonomySubmitting = false;
  taxonomyNewCategoryId: string | null = null;
  taxonomyNewCategoryName = '';
  taxonomyNewSubcategoryName = '';
  private taxonomyTarget: ((subcategoryId: string) => void) | null = null;

  ngOnInit(): void {
    this.packetId = this.route.snapshot.paramMap.get('id') || '';
    this.loading = true;

    forkJoin({
      packet: this.sockbowlQuestionsService.getPacketById(this.packetId),
      difficulties: this.packetAuthoring.getAllDifficulties(),
      categories: this.packetAuthoring.getAllCategories(),
      subcategories: this.packetAuthoring.getAllSubcategories()
    }).subscribe({
      next: ({ packet, difficulties, categories, subcategories }) => {
        this.difficulties = difficulties;
        this.categories = categories;
        this.allSubcategories = subcategories;
        this.rebuildSubcategoryGroups();
        this.applyPacket(packet);
        this.loading = false;
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
        this.loading = false;
      }
    });
  }

  /**
   * `canDeactivate` hook for {@link unsavedChangesGuard} (D6, fixes PB-03):
   * true whenever any tossup, bonus, or bonus part card has an unsaved edit.
   */
  hasUnsavedChanges(): boolean {
    return this.dirtyCount > 0;
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = true;
    }
  }

  /* ------------------------------- refetching ------------------------------ */

  private refetch(onDone?: () => void): void {
    this.sockbowlQuestionsService.getPacketById(this.packetId).subscribe({
      next: (packet) => {
        this.applyPacket(packet);
        onDone?.();
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  /**
   * Refetches after a `CONFLICT`. Keeps every dirty draft's in-progress
   * value (via `reseed`) but records which ids were dirty at reload time so
   * the template can flag them as "based on an older version".
   */
  reloadAfterConflict(): void {
    this.sockbowlQuestionsService.getPacketById(this.packetId).subscribe({
      next: (packet) => {
        this.conflictBanner = false;
        this.applyPacket(packet, true);
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  private applyPacket(packet: Packet | null, markStale = false): void {
    if (markStale) {
      this.staleDraftIds = new Set([
        ...this.tossupDraftStore.dirtyIds(),
        ...this.bonusDraftStore.dirtyIds(),
        ...this.bonusPartDraftStore.dirtyIds()
      ]);
    }
    this.packet = packet as AuthoringPacket | null;
    this.packetVersion = this.packet?.version ?? 0;
    this.reseedDraftStores();
  }

  private reseedDraftStores(): void {
    if (!this.packet) {
      this.tossupDraftStore.clear();
      this.bonusDraftStore.clear();
      this.bonusPartDraftStore.clear();
      return;
    }
    const tossupEntities: DraftEntitySource<TossupDraft>[] = this.packet.tossups.map(te => ({
      id: te.tossup.id,
      value: {
        question: te.tossup.question,
        answer: te.tossup.answer,
        subcategoryId: te.tossup.subcategory?.id ?? null
      }
    }));
    this.tossupDraftStore.reseed(tossupEntities);

    const bonusEntities: DraftEntitySource<BonusDraft>[] = this.packet.bonuses.map(be => ({
      id: be.bonus.id,
      value: {
        preamble: be.bonus.preamble ?? '',
        subcategoryId: be.bonus.subcategory?.id ?? null
      }
    }));
    this.bonusDraftStore.reseed(bonusEntities);

    const partEntities: DraftEntitySource<BonusPartDraft>[] = [];
    this.packet.bonuses.forEach(be => {
      be.bonus.bonusParts?.forEach(pe => {
        partEntities.push({
          id: pe.bonusPart.id,
          value: { question: pe.bonusPart.question, answer: pe.bonusPart.answer }
        });
      });
    });
    this.bonusPartDraftStore.reseed(partEntities);
  }

  private rebuildSubcategoryGroups(): void {
    const byCategory = new Map<string, Subcategory[]>();
    this.allSubcategories.forEach(sub => {
      const categoryName = sub.category?.name || 'Uncategorized';
      const list = byCategory.get(categoryName) || [];
      list.push(sub);
      byCategory.set(categoryName, list);
    });
    this.subcategoryGroups = Array.from(byCategory.entries())
      .map(([category, subs]) => ({ category, subs }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  /* --------------------------------- header --------------------------------- */

  /**
   * Single choke point for every mutating control in this component's
   * template: packet:manage-any holders can manage any packet; otherwise
   * only the owner (D3 — ownerless packets are manage-any only, no
   * grandfather rule).
   */
  get canManagePacket(): boolean {
    return this.auth.hasPermission('packet:manage-any')
      || (!!this.packet?.owner && this.packet.owner.id === this.auth.getCurrentUserId());
  }

  get sortedTossups(): TossupElement[] {
    return [...(this.packet?.tossups ?? [])].sort((a, b) => a.order - b.order);
  }

  get sortedBonuses(): BonusElement[] {
    return [...(this.packet?.bonuses ?? [])].sort((a, b) => a.order - b.order);
  }

  sortedParts(be: BonusElement): BonusPartElement[] {
    return [...(be.bonus.bonusParts ?? [])].sort((a, b) => a.order - b.order);
  }

  /** Total unsaved cards across tossups, bonuses, and bonus parts, shown as "N unsaved changes" in the header. */
  get dirtyCount(): number {
    return this.tossupDraftStore.dirtyCount + this.bonusDraftStore.dirtyCount + this.bonusPartDraftStore.dirtyCount;
  }

  get validation(): PacketValidation | null {
    return this.packet?.validation ?? null;
  }

  /** Category names across every tossup and bonus in the packet, most-used first (part of the PB-12 summary header). */
  get categoryDistribution(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    const bump = (name: string | undefined | null) => {
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    };
    this.packet?.tossups.forEach(te => bump(te.tossup.subcategory?.category?.name));
    this.packet?.bonuses.forEach(be => bump(be.bonus.subcategory?.category?.name));
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** D7 inline warnings for one bonus: part count other than 3, or an empty preamble. Non-blocking. */
  bonusWarnings(be: BonusElement): string[] {
    const warnings: string[] = [];
    const partCount = be.bonus.bonusParts?.length ?? 0;
    if (partCount !== this.limits.expectedPartsPerBonus) {
      warnings.push(`${partCount} part${partCount === 1 ? '' : 's'} (${this.limits.expectedPartsPerBonus} is expected)`);
    }
    if (!be.bonus.preamble?.trim()) {
      warnings.push('Empty preamble');
    }
    return warnings;
  }

  isStale(id: string): boolean {
    return this.staleDraftIds.has(id);
  }

  startEditName(): void {
    if (!this.packet) {
      return;
    }
    this.nameDraft = this.packet.name;
    this.editingName = true;
  }

  cancelEditName(): void {
    this.editingName = false;
  }

  saveName(): void {
    const name = this.nameDraft.trim();
    if (!name) {
      this.snackBar.open('Packet name is required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.savingName = true;
    this.packetAuthoring.renamePacket(this.packetId, name, this.packetVersion).subscribe({
      next: () => {
        this.savingName = false;
        this.editingName = false;
        this.refetch();
        this.snackBar.open('Name saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.savingName = false;
        this.handleMutationError(err);
      }
    });
  }

  onDifficultyChange(difficultyId: string): void {
    this.packetAuthoring.setPacketDifficulty(this.packetId, difficultyId, this.packetVersion).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Difficulty saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  deletePacket(): void {
    if (!this.packet) {
      return;
    }
    this.confirmDialog
      .confirm({
        title: `Delete packet "${this.packet.name}"?`,
        message: 'This cannot be undone.',
        confirmText: 'Delete',
        destructive: true
      })
      .subscribe(confirmed => {
        if (!confirmed) {
          return;
        }
        this.packetAuthoring.deletePacket(this.packetId, this.packetVersion).subscribe({
          next: () => {
            this.snackBar.open('Packet deleted', 'Dismiss', { duration: 2500 });
            this.router.navigate(['/packets']);
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  /* --------------------- preview / publish / export / clone ------------------ */

  /** Preview toggle (PB-07): swaps the tossup/bonus editor cards for the read-only reading view. */
  togglePreview(): void {
    this.showPreview = !this.showPreview;
  }

  /**
   * Draft/Published toggle (plan 3.3.3). Publishing an unplayable packet is
   * allowed by the server, but the UI asks for confirmation first and lists
   * the blocking ERRORs; un-publishing never needs confirmation.
   */
  setVisibility(next: PacketVisibility): void {
    if (!this.packet) {
      return;
    }
    const proceed = (): void => {
      this.packetAuthoring.setPacketVisibility(this.packetId, next, this.packetVersion).subscribe({
        next: () => {
          this.bumpLocalVersion();
          this.refetch();
          this.snackBar.open(next === 'PUBLISHED' ? 'Packet published' : 'Packet set back to draft', 'Dismiss', { duration: 2500 });
        },
        error: (err) => this.handleMutationError(err)
      });
    };

    if (next === 'PUBLISHED' && this.validation && !this.validation.playable) {
      const errors = this.validation.issues.filter(i => i.severity === 'ERROR').map(i => i.message);
      this.confirmDialog
        .confirm({
          title: 'Publish an unplayable packet?',
          message: `This packet isn't playable yet: ${errors.join('; ')}. It can still be published, but it won't work in a game until fixed.`,
          confirmText: 'Publish anyway',
          destructive: false
        })
        .subscribe(confirmed => {
          if (confirmed) {
            proceed();
          }
        });
    } else {
      proceed();
    }
  }

  /** "Duplicate" (plan 3.3.3): clones this packet and jumps straight into the new copy's builder. */
  duplicatePacket(): void {
    if (!this.packet) {
      return;
    }
    this.packetAuthoring.clonePacket(this.packetId).subscribe({
      next: (newId) => {
        this.snackBar.open('Packet duplicated', 'Dismiss', { duration: 2500 });
        this.router.navigate(['/packets', newId, 'edit']);
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  /** Export menu: "Plaintext (.txt)" (PB-06). */
  exportPlaintext(): void {
    if (!this.packet) {
      return;
    }
    this.sockbowlQuestionsService.exportPacket(this.packetId).subscribe({
      next: (text) => downloadTextFile(`${slugify(this.packet!.name)}.txt`, text, 'text/plain;charset=utf-8'),
      error: (err) => this.handleMutationError(err)
    });
  }

  /** Export menu: "JSON" (PB-06) — the already-fetched full packet, pretty-printed. */
  exportJson(): void {
    if (!this.packet) {
      return;
    }
    downloadTextFile(`${slugify(this.packet.name)}.json`, JSON.stringify(this.packet, null, 2), 'application/json;charset=utf-8');
  }

  /**
   * Export menu: "Print" (PB-06/PB-07). Switches to the preview tab (whose
   * reading view carries the `print-area` marker the global print
   * stylesheet targets) and prints on the next tick, so the DOM has updated
   * before the browser's print dialog opens.
   */
  printPacket(): void {
    this.showPreview = true;
    setTimeout(() => window.print(), 0);
  }

  /** "Play test" (PB-15): disabled by the template when the packet isn't playable. */
  playTest(): void {
    if (!this.packet) {
      return;
    }
    this.pendingPacket.set(this.packetId);
    this.router.navigate(['/game-session'], { queryParams: { mode: 'single', packetId: this.packetId } });
  }

  /* -------------------------------- drag and drop ---------------------------- */

  /**
   * Drag-and-drop reorder (PB-20). Applied optimistically (the dropped
   * entity's `order` — and every entity after it — is renumbered locally
   * before the server responds) and rolled back to the pre-drop order on
   * error. The up/down buttons remain for keyboard use.
   */
  dropTossup(event: CdkDragDrop<TossupElement[]>): void {
    if (!this.packet || event.previousIndex === event.currentIndex) {
      return;
    }
    const items = this.sortedTossups;
    const moved = items[event.previousIndex];
    const newOrder = event.currentIndex;
    const originalOrders = new Map(items.map(t => [t.tossup.id, t.order]));
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    items.forEach((t, i) => (t.order = i));

    this.packetAuthoring.reorderTossup(this.packetId, moved.tossup.id, newOrder, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
      },
      error: (err) => {
        items.forEach(t => (t.order = originalOrders.get(t.tossup.id)!));
        this.handleMutationError(err);
      }
    });
  }

  dropBonus(event: CdkDragDrop<BonusElement[]>): void {
    if (!this.packet || event.previousIndex === event.currentIndex) {
      return;
    }
    const items = this.sortedBonuses;
    const moved = items[event.previousIndex];
    const newOrder = event.currentIndex;
    const originalOrders = new Map(items.map(b => [b.bonus.id, b.order]));
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    items.forEach((b, i) => (b.order = i));

    this.packetAuthoring.reorderBonus(this.packetId, moved.bonus.id, newOrder, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
      },
      error: (err) => {
        items.forEach(b => (b.order = originalOrders.get(b.bonus.id)!));
        this.handleMutationError(err);
      }
    });
  }

  dropPart(be: BonusElement, event: CdkDragDrop<BonusPartElement[]>): void {
    if (!this.packet || event.previousIndex === event.currentIndex) {
      return;
    }
    const items = this.sortedParts(be);
    const moved = items[event.previousIndex];
    const newOrder = event.currentIndex;
    const originalOrders = new Map(items.map(p => [p.bonusPart.id, p.order]));
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    items.forEach((p, i) => (p.order = i));

    this.packetAuthoring.reorderBonusPart(be.bonus.id, moved.bonusPart.id, newOrder, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
      },
      error: (err) => {
        items.forEach(p => (p.order = originalOrders.get(p.bonusPart.id)!));
        this.handleMutationError(err);
      }
    });
  }

  /* -------------------------- error / conflict handling ---------------------- */

  private bumpLocalVersion(): void {
    this.packetVersion = this.packetVersion + 1;
  }

  /** Every mutation's error handler: a CONFLICT opens the persistent banner instead of a snackbar. */
  private handleMutationError(err: unknown): void {
    if (err instanceof GraphqlRequestError && err.classification === 'CONFLICT') {
      this.conflictBanner = true;
      return;
    }
    this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
  }

  /* -------------------------------- tossups -------------------------------- */

  private saveTossupMutations(id: string): Observable<unknown> {
    const draft = this.tossupDraftStore.getDraft(id);
    if (!draft) {
      return of(null);
    }
    const { value, original } = draft;
    if (!value.question.trim() || !value.answer.trim()) {
      return throwError(() => new Error('Question and answer are both required'));
    }
    const update$ = this.packetAuthoring
      .updateTossup(id, { question: value.question.trim(), answer: value.answer.trim() }, this.packetVersion)
      .pipe(tap(() => this.bumpLocalVersion()));

    // `updateTossup` treats a null `subcategoryId` as "no change" (plan 3.1.7),
    // so clearing (or otherwise changing) it always goes through the
    // dedicated `setTossupSubcategory` mutation instead.
    if (value.subcategoryId === original.subcategoryId) {
      return update$;
    }
    return update$.pipe(
      switchMap(() => this.packetAuthoring.setTossupSubcategory(id, value.subcategoryId, this.packetVersion)),
      tap(() => this.bumpLocalVersion())
    );
  }

  saveTossup(te: TossupElement): void {
    this.saveTossupMutations(te.tossup.id).subscribe({
      next: () => {
        this.tossupDraftStore.markSaved(te.tossup.id);
        this.refetch();
        this.snackBar.open('Tossup saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  revertTossup(te: TossupElement): void {
    this.tossupDraftStore.revert(te.tossup.id);
  }

  removeTossup(te: TossupElement): void {
    this.confirmDialog
      .confirm({
        title: `Remove tossup ${te.order + 1}?`,
        message: `"${this.truncate(te.tossup.question, 80)}" will be removed from this packet.`,
        confirmText: 'Remove',
        destructive: true
      })
      .subscribe(confirmed => {
        if (!confirmed) {
          return;
        }
        this.packetAuthoring.removeTossupFromPacket(this.packetId, te.tossup.id, this.packetVersion).subscribe({
          next: () => {
            this.refetch();
            this.snackBar.open('Tossup removed', 'Dismiss', { duration: 2500 });
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  moveTossup(te: TossupElement, delta: number): void {
    const newOrder = te.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedTossups.length) {
      return;
    }
    this.packetAuthoring.reorderTossup(this.packetId, te.tossup.id, newOrder, this.packetVersion).subscribe({
      next: () => this.refetch(),
      error: (err) => this.handleMutationError(err)
    });
  }

  openNewTossup(): void {
    this.newTossupOpen = true;
    this.newTossupDraft = { question: '', answer: '', subcategoryId: null };
  }

  cancelNewTossup(): void {
    this.newTossupOpen = false;
  }

  addTossup(): void {
    if (!this.newTossupDraft.question.trim() || !this.newTossupDraft.answer.trim()) {
      this.snackBar.open('Question and answer are both required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.addingTossup = true;
    this.packetAuthoring.addTossupToPacket(this.packetId, {
      question: this.newTossupDraft.question.trim(),
      answer: this.newTossupDraft.answer.trim(),
      subcategoryId: this.newTossupDraft.subcategoryId
    }, null, this.packetVersion).subscribe({
      next: () => {
        this.addingTossup = false;
        this.newTossupOpen = false;
        this.refetch();
        this.snackBar.open('Tossup added', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.addingTossup = false;
        this.handleMutationError(err);
      }
    });
  }

  /* ------------------------------ AI-assist tossup --------------------------- */

  openGenerate(): void {
    this.genOpen = true;
    this.genDraft = { topic: '', additionalContext: '', subcategoryId: null, apiKey: '', model: '' };
  }

  cancelGenerate(): void {
    this.genOpen = false;
  }

  generateTossup(): void {
    if (!this.genDraft.topic.trim()) {
      this.snackBar.open('A topic is required', 'Dismiss', { duration: 3000 });
      return;
    }
    if (!this.genDraft.apiKey.trim()) {
      this.snackBar.open('An OpenAI API key is required to generate a question', 'Dismiss', { duration: 3000 });
      return;
    }
    this.genSubmitting = true;
    this.packetAuthoring.generateAndAddTossup(this.packetId, {
      topic: this.genDraft.topic.trim(),
      additionalContext: this.genDraft.additionalContext.trim() || null,
      subcategoryId: this.genDraft.subcategoryId,
      apiKey: this.genDraft.apiKey.trim(),
      model: this.genDraft.model || null
    }, null, this.packetVersion).subscribe({
      next: () => {
        this.genSubmitting = false;
        this.genOpen = false;
        this.refetch();
        this.snackBar.open('Tossup generated', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.genSubmitting = false;
        this.handleMutationError(err);
      }
    });
  }

  /* -------------------------------- bonuses -------------------------------- */

  private saveBonusMutations(id: string): Observable<unknown> {
    const draft = this.bonusDraftStore.getDraft(id);
    if (!draft) {
      return of(null);
    }
    const { value, original } = draft;
    const update$ = this.packetAuthoring
      .updateBonus(id, { preamble: value.preamble.trim() || null }, this.packetVersion)
      .pipe(tap(() => this.bumpLocalVersion()));

    if (value.subcategoryId === original.subcategoryId) {
      return update$;
    }
    return update$.pipe(
      switchMap(() => this.packetAuthoring.setBonusSubcategory(id, value.subcategoryId, this.packetVersion)),
      tap(() => this.bumpLocalVersion())
    );
  }

  saveBonus(be: BonusElement): void {
    this.saveBonusMutations(be.bonus.id).subscribe({
      next: () => {
        this.bonusDraftStore.markSaved(be.bonus.id);
        this.refetch();
        this.snackBar.open('Bonus saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  revertBonus(be: BonusElement): void {
    this.bonusDraftStore.revert(be.bonus.id);
  }

  removeBonus(be: BonusElement): void {
    this.confirmDialog
      .confirm({
        title: `Remove bonus ${be.order + 1}?`,
        message: 'This bonus and its parts will be removed from this packet.',
        confirmText: 'Remove',
        destructive: true
      })
      .subscribe(confirmed => {
        if (!confirmed) {
          return;
        }
        this.packetAuthoring.removeBonusFromPacket(this.packetId, be.bonus.id, this.packetVersion).subscribe({
          next: () => {
            this.refetch();
            this.snackBar.open('Bonus removed', 'Dismiss', { duration: 2500 });
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  moveBonus(be: BonusElement, delta: number): void {
    const newOrder = be.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedBonuses.length) {
      return;
    }
    this.packetAuthoring.reorderBonus(this.packetId, be.bonus.id, newOrder, this.packetVersion).subscribe({
      next: () => this.refetch(),
      error: (err) => this.handleMutationError(err)
    });
  }

  private freshNewBonusDraft(): NewBonusDraft {
    return {
      preamble: '',
      subcategoryId: null,
      parts: Array.from({ length: this.limits.expectedPartsPerBonus }, () => ({ question: '', answer: '' }))
    };
  }

  /** Opens the new-bonus form (plan 3.3.2): a bonus is only created once its parts are filled in, never empty. */
  openNewBonus(): void {
    this.newBonusOpen = true;
    this.newBonusDraft = this.freshNewBonusDraft();
  }

  cancelNewBonus(): void {
    this.newBonusOpen = false;
  }

  addNewBonusPartRow(): void {
    if (this.newBonusDraft.parts.length < this.limits.maxPartsPerBonus) {
      this.newBonusDraft.parts.push({ question: '', answer: '' });
    }
  }

  removeNewBonusPartRow(index: number): void {
    if (this.newBonusDraft.parts.length > this.limits.minPartsPerBonus) {
      this.newBonusDraft.parts.splice(index, 1);
    }
  }

  submitNewBonus(): void {
    const parts = this.newBonusDraft.parts;
    if (!parts.length || parts.some(p => !p.question.trim() || !p.answer.trim())) {
      this.snackBar.open('Every part needs a question and an answer', 'Dismiss', { duration: 3000 });
      return;
    }
    this.addingBonus = true;
    this.packetAuthoring.addBonusToPacket(this.packetId, {
      preamble: this.newBonusDraft.preamble.trim() || null,
      subcategoryId: this.newBonusDraft.subcategoryId,
      parts: parts.map(p => ({ question: p.question.trim(), answer: p.answer.trim() }))
    }, null, this.packetVersion).subscribe({
      next: () => {
        this.addingBonus = false;
        this.newBonusOpen = false;
        this.refetch(() => {
          const bonuses = this.packet?.bonuses ?? [];
          this.justAddedBonusId = bonuses.length
            ? bonuses.reduce((max, b) => (b.order > max.order ? b : max)).bonus.id
            : null;
        });
        this.snackBar.open('Bonus added', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.addingBonus = false;
        this.handleMutationError(err);
      }
    });
  }

  isJustAdded(be: BonusElement): boolean {
    return this.justAddedBonusId === be.bonus.id;
  }

  /* ------------------------------ bonus parts ------------------------------ */

  private savePartMutations(bonusId: string, partId: string): Observable<unknown> {
    const draft = this.bonusPartDraftStore.getDraft(partId);
    if (!draft) {
      return of(null);
    }
    const { value } = draft;
    if (!value.question.trim() || !value.answer.trim()) {
      return throwError(() => new Error('Question and answer are both required'));
    }
    return this.packetAuthoring
      .updateBonusPart(bonusId, partId, { question: value.question.trim(), answer: value.answer.trim() }, this.packetVersion)
      .pipe(tap(() => this.bumpLocalVersion()));
  }

  savePart(be: BonusElement, pe: BonusPartElement): void {
    this.savePartMutations(be.bonus.id, pe.bonusPart.id).subscribe({
      next: () => {
        this.bonusPartDraftStore.markSaved(pe.bonusPart.id);
        this.refetch();
        this.snackBar.open('Bonus part saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  revertPart(pe: BonusPartElement): void {
    this.bonusPartDraftStore.revert(pe.bonusPart.id);
  }

  removePart(be: BonusElement, pe: BonusPartElement): void {
    this.confirmDialog
      .confirm({
        title: 'Remove this bonus part?',
        message: `"${this.truncate(pe.bonusPart.question, 80)}" will be removed.`,
        confirmText: 'Remove',
        destructive: true
      })
      .subscribe(confirmed => {
        if (!confirmed) {
          return;
        }
        this.packetAuthoring.removeBonusPart(be.bonus.id, pe.bonusPart.id, this.packetVersion).subscribe({
          next: () => {
            this.refetch();
            this.snackBar.open('Bonus part removed', 'Dismiss', { duration: 2500 });
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  movePart(be: BonusElement, pe: BonusPartElement, delta: number): void {
    const parts = this.sortedParts(be);
    const newOrder = pe.order + delta;
    if (newOrder < 0 || newOrder >= parts.length) {
      return;
    }
    this.packetAuthoring.reorderBonusPart(be.bonus.id, pe.bonusPart.id, newOrder, this.packetVersion).subscribe({
      next: () => this.refetch(),
      error: (err) => this.handleMutationError(err)
    });
  }

  openNewPart(be: BonusElement): void {
    this.newPartOpen[be.bonus.id] = true;
    this.newPartDrafts[be.bonus.id] = { question: '', answer: '' };
  }

  cancelNewPart(be: BonusElement): void {
    this.newPartOpen[be.bonus.id] = false;
  }

  addPart(be: BonusElement): void {
    const draft = this.newPartDrafts[be.bonus.id];
    if (!draft || !draft.question.trim() || !draft.answer.trim()) {
      this.snackBar.open('Question and answer are both required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.packetAuthoring.addBonusPart(be.bonus.id, {
      question: draft.question.trim(),
      answer: draft.answer.trim()
    }, null, this.packetVersion).subscribe({
      next: () => {
        this.newPartOpen[be.bonus.id] = false;
        this.refetch();
        this.snackBar.open('Bonus part added', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.handleMutationError(err)
    });
  }

  /* --------------------------------- Save all -------------------------------- */

  private saveOneEntity(item: SaveWorkItem): Observable<unknown> {
    switch (item.kind) {
      case 'tossup':
        return this.saveTossupMutations(item.id);
      case 'bonus':
        return this.saveBonusMutations(item.id);
      case 'part':
        return this.savePartMutations(item.bonusId, item.id);
    }
  }

  private markEntitySaved(item: SaveWorkItem): void {
    switch (item.kind) {
      case 'tossup':
        this.tossupDraftStore.markSaved(item.id);
        break;
      case 'bonus':
        this.bonusDraftStore.markSaved(item.id);
        break;
      case 'part':
        this.bonusPartDraftStore.markSaved(item.id);
        break;
    }
  }

  /** Every dirty tossup, bonus, and bonus part, in packet order (tossups, then each bonus and its parts). */
  private buildSaveWorklist(): SaveWorkItem[] {
    const items: SaveWorkItem[] = [];
    this.sortedTossups.forEach(te => {
      if (this.tossupDraftStore.isDirty(te.tossup.id)) {
        items.push({ kind: 'tossup', id: te.tossup.id });
      }
    });
    this.sortedBonuses.forEach(be => {
      if (this.bonusDraftStore.isDirty(be.bonus.id)) {
        items.push({ kind: 'bonus', id: be.bonus.id });
      }
      this.sortedParts(be).forEach(pe => {
        if (this.bonusPartDraftStore.isDirty(pe.bonusPart.id)) {
          items.push({ kind: 'part', id: pe.bonusPart.id, bonusId: be.bonus.id });
        }
      });
    });
    return items;
  }

  /**
   * Saves every dirty card, sequentially, in packet order, stopping at the
   * first error (plan 3.3.2). Unlike a single card's Save, this batches its
   * refetch to one call at the end rather than one per entity: fewer
   * requests for a large packet, which also helps stay under M4's
   * `graphql-write` rate limit after the M3/M4 merge (risk 12).
   */
  saveAll(): void {
    if (this.savingAll) {
      return;
    }
    const worklist = this.buildSaveWorklist();
    if (!worklist.length) {
      return;
    }
    this.savingAll = true;
    this.runSaveWorklist(worklist, 0);
  }

  private runSaveWorklist(items: SaveWorkItem[], index: number): void {
    if (index >= items.length) {
      this.savingAll = false;
      this.refetch();
      this.snackBar.open('All changes saved', 'Dismiss', { duration: 2500 });
      return;
    }
    this.saveOneEntity(items[index]).subscribe({
      next: () => {
        this.markEntitySaved(items[index]);
        this.runSaveWorklist(items, index + 1);
      },
      error: (err) => {
        this.savingAll = false;
        this.refetch();
        this.handleMutationError(err);
      }
    });
  }

  /* --------------------------- taxonomy quick-add --------------------------- */

  openTaxonomyForm(setter: (subcategoryId: string) => void): void {
    this.taxonomyFormOpen = true;
    this.taxonomyTarget = setter;
    this.taxonomyNewCategoryId = null;
    this.taxonomyNewCategoryName = '';
    this.taxonomyNewSubcategoryName = '';
  }

  cancelTaxonomyForm(): void {
    this.taxonomyFormOpen = false;
    this.taxonomyTarget = null;
  }

  submitTaxonomyForm(): void {
    const subName = this.taxonomyNewSubcategoryName.trim();
    if (!subName) {
      this.snackBar.open('A subcategory name is required', 'Dismiss', { duration: 3000 });
      return;
    }

    const newCategoryName = this.taxonomyNewCategoryName.trim();
    if (!newCategoryName && !this.taxonomyNewCategoryId) {
      this.snackBar.open('Pick an existing category or create a new one', 'Dismiss', { duration: 3000 });
      return;
    }

    this.taxonomySubmitting = true;

    const createSubcategory = (categoryId: string) => {
      this.packetAuthoring.createSubcategory(subName, categoryId).subscribe({
        next: (sub) => {
          this.taxonomySubmitting = false;
          this.taxonomyFormOpen = false;
          this.allSubcategories.push(sub);
          this.rebuildSubcategoryGroups();
          if (this.taxonomyTarget) {
            this.taxonomyTarget(sub.id);
          }
          this.taxonomyTarget = null;
          this.snackBar.open('Subcategory created', 'Dismiss', { duration: 2500 });
        },
        error: (err) => {
          this.taxonomySubmitting = false;
          this.handleMutationError(err);
        }
      });
    };

    if (newCategoryName) {
      this.packetAuthoring.createCategory(newCategoryName).subscribe({
        next: (category) => {
          this.categories.push(category);
          createSubcategory(category.id);
        },
        error: (err) => {
          this.taxonomySubmitting = false;
          this.handleMutationError(err);
        }
      });
    } else if (this.taxonomyNewCategoryId) {
      createSubcategory(this.taxonomyNewCategoryId);
    }
  }

  /* -------------------------------- helpers --------------------------------- */

  truncate(text: string, length = 80): string {
    if (!text) {
      return '';
    }
    return text.length > length ? text.slice(0, length) + '...' : text;
  }

  /** Sets a tossup draft's subcategory (used by the taxonomy quick-add form's callback) and marks it dirty. */
  setTossupSubcategoryDraft(tossupId: string, subcategoryId: string): void {
    const draft = this.tossupDraftStore.get(tossupId);
    if (draft) {
      draft.subcategoryId = subcategoryId;
      this.tossupDraftStore.markDirty(tossupId);
    }
  }

  /** Sets a bonus draft's subcategory (used by the taxonomy quick-add form's callback) and marks it dirty. */
  setBonusSubcategoryDraft(bonusId: string, subcategoryId: string): void {
    const draft = this.bonusDraftStore.get(bonusId);
    if (draft) {
      draft.subcategoryId = subcategoryId;
      this.bonusDraftStore.markDirty(bonusId);
    }
  }

  subcategoryName(id: string | null | undefined): string {
    if (!id) {
      return '';
    }
    return this.allSubcategories.find(s => s.id === id)?.name || '';
  }

  extractError(err: unknown): string {
    return describeGraphqlError(err);
  }
}

/** Lowercase, hyphenated filename stem from a packet name, never empty (mirrors `packet-list`'s helper). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'packet';
}

/** Triggers a browser download of `text` as a file named `filename` (export menu, PB-06). */
function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
