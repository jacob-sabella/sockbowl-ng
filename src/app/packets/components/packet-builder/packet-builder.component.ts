import { Component, OnInit, ChangeDetectionStrategy, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LiveAnnouncer } from '@angular/cdk/a11y';
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
  Subcategory,
  ValidationIssue
} from '../../models/packet-authoring.models';
import { PACKET_LIMITS } from '../../models/packet-limits';
import { AuthService } from '../../../core/auth/auth.service';
import { describeGraphqlError, GraphqlRequestError } from '../../../core/graphql/graphql-errors';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { limitErrorFrom, notifyLimit } from '../../../core/http/limit-errors';
import { RateLimitStateService } from '../../../core/http/rate-limit-state.service';
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

/** S4-13: which per-class message/recovery the builder's initial load renders. */
type PacketLoadErrorKind = 'not-found' | 'forbidden' | 'network';

interface PacketLoadError {
  kind: PacketLoadErrorKind;
  message: string;
}

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
  private rateLimitState = inject(RateLimitStateService);
  private liveAnnouncer = inject(LiveAnnouncer);
  auth = inject(AuthService);

  limits = PACKET_LIMITS;

  packetId = '';
  packet: AuthoringPacket | null = null;
  loading = true;
  /** S4-13: set instead of `packet` staying null when the initial load fails, so the template can render a per-class state. */
  loadError: PacketLoadError | null = null;

  /** The packet's last-known-good version, sent as `expectedVersion` on every content mutation (PB-18). */
  packetVersion = 0;

  /** Set when a mutation returns `CONFLICT`: shown as a persistent banner instead of a snackbar. */
  conflictBanner = false;
  /** Entity ids that were dirty at the moment of a conflict reload, so their cards can say "based on an older version". */
  staleDraftIds = new Set<string>();

  savingAll = false;
  /** S4-06: 1-based index/total of the item currently in flight, shown as "Saving N of M…" on the sticky bar. */
  saveAllCurrent = 0;
  saveAllTotal = 0;

  /** S4-05: entity ids with a Save mutation in flight, so a second click before the response lands is a no-op. */
  savingTossupIds = new Set<string>();
  savingBonusIds = new Set<string>();
  savingPartIds = new Set<string>();

  /** S4-06: the last Save-all failure's message, keyed by entity id, rendered inline on that card. Cleared on the next attempt to save that card. */
  entitySaveErrors: Record<string, string> = {};

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

  /**
   * S4-08: which tossup/bonus panel a validation issue link opened. Synced
   * from the panel's own (opened)/(closed) events so a manual click on a
   * different panel (and the accordion's own close-others behavior) always
   * wins over this state, never fights it.
   */
  expandedTossupId: string | null = null;
  expandedBonusId: string | null = null;
  /** Set by {@link focusIssue}; consumed once by the matching panel's (afterExpand) to scroll/focus it, then cleared. */
  private pendingFocusEntityId: string | null = null;

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
  /** S4-17: the element that opened the dialog (a "Create new subcategory" icon button), so focus can return to it on close. */
  private taxonomyTriggerEl: HTMLElement | null = null;

  /**
   * S4-17: the taxonomy overlay is a hand-rolled dialog (no MatDialog/
   * cdkTrapFocus — see H-02), so moving focus in has to happen once the
   * `@if` actually renders it. A `ViewChild` setter fires exactly then,
   * synchronously with change detection, which a `ngOnChanges`/`ngOnInit`
   * hook on the component itself cannot (they only see `taxonomyFormOpen`
   * flip, not the child's presence in the DOM).
   */
  @ViewChild('taxonomyDialog', { read: ElementRef }) set taxonomyDialogRef(ref: ElementRef<HTMLElement> | undefined) {
    if (ref) {
      queueMicrotask(() => this.focusFirstFocusable(ref.nativeElement));
    }
  }

  ngOnInit(): void {
    this.packetId = this.route.snapshot.paramMap.get('id') || '';
    this.loadPacket();
  }

  /**
   * S4-13: the initial load, factored out of ngOnInit so {@link retryLoad}
   * can call it again after a network/500 failure. A 404/403 renders a
   * per-class state with no Retry (loading the same id again can't help);
   * anything else renders "Couldn't load this packet" with Retry. Unlike
   * the old behavior, a load failure never shows a generic snackbar here —
   * the state block is the single source of truth for why the page is
   * empty (H-06/S4-13: a NOT_FOUND-flavored snackbar text was previously
   * shown for every failure, including ones that had nothing to do with
   * deletion).
   */
  private loadPacket(): void {
    this.loading = true;
    this.loadError = null;

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
        this.loading = false;
        this.loadError = this.classifyLoadError(err);
      }
    });
  }

  /** S4-13: retry for the network/500 load-error state. */
  retryLoad(): void {
    this.loadPacket();
  }

  private classifyLoadError(err: unknown): PacketLoadError {
    if (err instanceof GraphqlRequestError) {
      if (err.classification === 'NOT_FOUND') {
        return { kind: 'not-found', message: "This packet doesn't exist or was deleted" };
      }
      if (err.classification === 'FORBIDDEN') {
        return { kind: 'forbidden', message: "You don't have access to this packet" };
      }
    }
    return { kind: 'network', message: "Couldn't load this packet" };
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

  /** S4-21: Ctrl/Cmd+S saves every dirty card, same as pressing "Save all". Only claims the shortcut when there's something to save. */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      if (this.canManagePacket && this.dirtyCount > 0 && !this.savingAll) {
        event.preventDefault();
        this.saveAll();
      }
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
    const userId = this.auth.getCurrentUserId();
    // A non-owner's read has owner.id redacted to null (D2); require a real,
    // non-null current-user id before comparing so a not-yet-resolved id
    // can never spuriously match that null (NG-R2-04).
    return this.auth.hasPermission('packet:manage-any')
      || (!!userId && !!this.packet?.owner && this.packet.owner.id === userId);
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

  isSavingTossup(id: string): boolean {
    return this.savingTossupIds.has(id);
  }

  isSavingBonus(id: string): boolean {
    return this.savingBonusIds.has(id);
  }

  isSavingPart(id: string): boolean {
    return this.savingPartIds.has(id);
  }

  /** S4-16: true while any save (a single card, or Save all) is in flight, so drag/reorder can refuse to start. */
  get anySavingInFlight(): boolean {
    return (
      this.savingAll ||
      this.savingName ||
      this.savingTossupIds.size > 0 ||
      this.savingBonusIds.size > 0 ||
      this.savingPartIds.size > 0
    );
  }

  /**
   * S4-15/FF1 (finish review #3): an admin (or other `packet:manage-any`
   * holder) editing someone else's packet sees whose it is. Null for the
   * owner themself, and for an ownerless/nameless packet with no display
   * name to show.
   *
   * `owner.id` is redacted to `null` for a non-owner's read (`PacketOwner`,
   * D2/Q-M2-01) — a viewer who isn't the owner never gets a real id back,
   * only a name. The old guard required a truthy `owner.id` before it would
   * even consider showing the name, so the redacted (and by definition
   * "not you") case fell through to `null` and hid the line on exactly the
   * admin-viewing-someone-else's-packet capture this exists for. A
   * redacted id therefore always means "not you"; only a *present* id is
   * worth comparing against the current user's own Keycloak id
   * (`auth.getCurrentUserId()`, the `sub` claim — the same space `owner.id`
   * is in when it isn't redacted).
   */
  get ownerDisplayName(): string | null {
    const owner = this.packet?.owner;
    if (!owner?.name) {
      return null;
    }
    if (owner.id == null) {
      return owner.name;
    }
    return owner.id === this.auth.getCurrentUserId() ? null : owner.name;
  }

  /* --------------------------- validation issue links ------------------------ */

  /**
   * S4-08: a validation issue naming a tossup or bonus opens that card,
   * scrolls it into view, and focuses its first field. Issues with no
   * target (a packet-wide rule) render as plain text in the template
   * instead of calling this.
   */
  focusIssue(issue: ValidationIssue): void {
    if (issue.tossupId) {
      this.pendingFocusEntityId = issue.tossupId;
      this.expandedTossupId = issue.tossupId;
    } else if (issue.bonusId) {
      this.pendingFocusEntityId = issue.bonusId;
      this.expandedBonusId = issue.bonusId;
    }
  }

  onTossupPanelClosed(id: string): void {
    if (this.expandedTossupId === id) {
      this.expandedTossupId = null;
    }
  }

  onTossupPanelExpanded(id: string): void {
    if (this.pendingFocusEntityId && this.expandedTossupId === id) {
      const target = this.pendingFocusEntityId;
      this.pendingFocusEntityId = null;
      this.scrollAndFocusEntity(target);
    }
  }

  onBonusPanelClosed(id: string): void {
    if (this.expandedBonusId === id) {
      this.expandedBonusId = null;
    }
  }

  /**
   * The pending focus target can be the bonus itself (a bonus-level
   * validation issue) or one of its parts (a Save-all failure on a part,
   * S4-06) — either way, the target is only reachable once *this* bonus's
   * panel ({@link expandedBonusId}) is the one that just opened.
   */
  onBonusPanelExpanded(id: string): void {
    if (this.pendingFocusEntityId && this.expandedBonusId === id) {
      const target = this.pendingFocusEntityId;
      this.pendingFocusEntityId = null;
      this.scrollAndFocusEntity(target);
    }
  }

  /** Scrolls the card carrying `data-entity-id="id"` into view and focuses its first field (S4-08). */
  private scrollAndFocusEntity(id: string): void {
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-entity-id="${id}"]`);
      if (!el) {
        return;
      }
      let reduceMotion = false;
      try {
        reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch {
        // matchMedia can be unavailable in some test environments; default to smooth.
      }
      el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      el.querySelector<HTMLElement>('textarea, input')?.focus();
    });
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
    if (this.savingName) {
      return;
    }
    const name = this.nameDraft.trim();
    if (!name) {
      this.snackBar.open('Packet name is required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.savingName = true;
    this.packetAuthoring.renamePacket(this.packetId, name, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
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
        this.bumpLocalVersion();
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
    const owner = this.ownerDisplayName;
    this.confirmDialog
      .confirm({
        title: `Delete packet "${this.packet.name}"?`,
        message: owner ? `This cannot be undone. Owned by ${owner}.` : 'This cannot be undone.',
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
    // NG-V1-05: don't pre-set the pending packet here. GameSessionComponent
    // sets it from the `packetId` query param this navigation carries, so a
    // second, earlier write is redundant and is exactly what goes stale if
    // navigation is cancelled (e.g. the unsaved-changes guard) or the solo
    // game fails to start.
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
    if (!this.packet || event.previousIndex === event.currentIndex || this.anySavingInFlight) {
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
    if (!this.packet || event.previousIndex === event.currentIndex || this.anySavingInFlight) {
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
    if (!this.packet || event.previousIndex === event.currentIndex || this.anySavingInFlight) {
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

  /**
   * Every mutation's error handler (HD: wires every §2 error class to one
   * outcome). A CONFLICT opens the persistent banner instead of a snackbar.
   * RATE_LIMITED, QUOTA_EXCEEDED, and BANNED go through M4's `notifyLimit`
   * so the message includes the cooldown/quota/ban detail instead of the
   * generic text `describeGraphqlError` would otherwise show — exactly one
   * snackbar either way, never both.
   */
  private handleMutationError(err: unknown): void {
    if (err instanceof GraphqlRequestError) {
      if (err.classification === 'CONFLICT') {
        this.conflictBanner = true;
        return;
      }
      const limitError = limitErrorFrom(err.classification, err.extensions);
      if (limitError) {
        notifyLimit(limitError, this.snackBar, this.rateLimitState);
        return;
      }
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

  /** S4-05: a click while this tossup's own Save is already in flight is a no-op (the template also disables the button). */
  saveTossup(te: TossupElement): void {
    if (this.savingTossupIds.has(te.tossup.id)) {
      return;
    }
    this.savingTossupIds.add(te.tossup.id);
    delete this.entitySaveErrors[te.tossup.id];
    this.saveTossupMutations(te.tossup.id).subscribe({
      next: () => {
        this.savingTossupIds.delete(te.tossup.id);
        this.tossupDraftStore.markSaved(te.tossup.id);
        this.refetch();
        this.snackBar.open('Tossup saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.savingTossupIds.delete(te.tossup.id);
        this.handleMutationError(err);
      }
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
            this.bumpLocalVersion();
            this.refetch();
            this.snackBar.open('Tossup removed', 'Dismiss', { duration: 2500 });
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  /** S4-16/S4-19: the keyboard/header reorder path — same guard as the drag drop lists, and a live-region announcement (S4-19) since the mover may be a collapsed header button, not just the always-visible drag handle. */
  moveTossup(te: TossupElement, delta: number): void {
    if (this.anySavingInFlight) {
      return;
    }
    const newOrder = te.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedTossups.length) {
      return;
    }
    const fromPosition = te.order + 1;
    const toPosition = newOrder + 1;
    this.packetAuthoring.reorderTossup(this.packetId, te.tossup.id, newOrder, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
        this.liveAnnouncer.announce(`Tossup ${fromPosition} moved to position ${toPosition}`, 'polite');
      },
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
        this.bumpLocalVersion();
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
        this.bumpLocalVersion();
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

  /** S4-05: a click while this bonus's own Save is already in flight is a no-op (the template also disables the button). */
  saveBonus(be: BonusElement): void {
    if (this.savingBonusIds.has(be.bonus.id)) {
      return;
    }
    this.savingBonusIds.add(be.bonus.id);
    delete this.entitySaveErrors[be.bonus.id];
    this.saveBonusMutations(be.bonus.id).subscribe({
      next: () => {
        this.savingBonusIds.delete(be.bonus.id);
        this.bonusDraftStore.markSaved(be.bonus.id);
        this.refetch();
        this.snackBar.open('Bonus saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.savingBonusIds.delete(be.bonus.id);
        this.handleMutationError(err);
      }
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
            this.bumpLocalVersion();
            this.refetch();
            this.snackBar.open('Bonus removed', 'Dismiss', { duration: 2500 });
          },
          error: (err) => this.handleMutationError(err)
        });
      });
  }

  /** S4-16/S4-19: see {@link moveTossup}. */
  moveBonus(be: BonusElement, delta: number): void {
    if (this.anySavingInFlight) {
      return;
    }
    const newOrder = be.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedBonuses.length) {
      return;
    }
    const fromPosition = be.order + 1;
    const toPosition = newOrder + 1;
    this.packetAuthoring.reorderBonus(this.packetId, be.bonus.id, newOrder, this.packetVersion).subscribe({
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
        this.liveAnnouncer.announce(`Bonus ${fromPosition} moved to position ${toPosition}`, 'polite');
      },
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
        this.bumpLocalVersion();
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

  /** S4-05: a click while this part's own Save is already in flight is a no-op (the template also disables the button). */
  savePart(be: BonusElement, pe: BonusPartElement): void {
    if (this.savingPartIds.has(pe.bonusPart.id)) {
      return;
    }
    this.savingPartIds.add(pe.bonusPart.id);
    delete this.entitySaveErrors[pe.bonusPart.id];
    this.savePartMutations(be.bonus.id, pe.bonusPart.id).subscribe({
      next: () => {
        this.savingPartIds.delete(pe.bonusPart.id);
        this.bonusPartDraftStore.markSaved(pe.bonusPart.id);
        this.refetch();
        this.snackBar.open('Bonus part saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.savingPartIds.delete(pe.bonusPart.id);
        this.handleMutationError(err);
      }
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
            this.bumpLocalVersion();
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
      next: () => {
        this.bumpLocalVersion();
        this.refetch();
      },
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
        this.bumpLocalVersion();
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
    this.saveAllTotal = worklist.length;
    this.saveAllCurrent = 0;
    this.entitySaveErrors = {};
    this.runSaveWorklist(worklist, 0);
  }

  /**
   * S4-06: sequential save, one item at a time, in packet order. On
   * failure it stops (remaining dirty cards stay dirty), refetches, expands
   * + scrolls + focuses the failing card and renders the error inline on
   * it, and routes the failure through {@link handleMutationError} so a
   * 429/QUOTA/BANNED response shows exactly one snackbar (via
   * `notifyLimit`) instead of stacking a second generic one on top.
   */
  private runSaveWorklist(items: SaveWorkItem[], index: number): void {
    if (index >= items.length) {
      this.savingAll = false;
      this.saveAllTotal = 0;
      this.saveAllCurrent = 0;
      this.refetch();
      this.snackBar.open('All changes saved', 'Dismiss', { duration: 2500 });
      return;
    }
    this.saveAllCurrent = index + 1;
    const item = items[index];
    this.saveOneEntity(item).subscribe({
      next: () => {
        this.markEntitySaved(item);
        this.runSaveWorklist(items, index + 1);
      },
      error: (err) => {
        this.savingAll = false;
        this.saveAllTotal = 0;
        this.saveAllCurrent = 0;
        this.refetch();
        this.entitySaveErrors[item.id] = this.extractError(err);
        this.focusSaveWorkItem(item);
        this.handleMutationError(err);
      }
    });
  }

  /** S4-06: expands (if needed) and scrolls/focuses the card a failed Save-all item belongs to. A bonus part's target is its parent bonus panel. */
  private focusSaveWorkItem(item: SaveWorkItem): void {
    if (item.kind === 'tossup') {
      const alreadyOpen = this.expandedTossupId === item.id;
      this.expandedTossupId = item.id;
      this.pendingFocusEntityId = item.id;
      if (alreadyOpen) {
        this.scrollAndFocusEntity(item.id);
      }
      return;
    }
    const bonusId = item.kind === 'bonus' ? item.id : item.bonusId;
    const alreadyOpen = this.expandedBonusId === bonusId;
    this.expandedBonusId = bonusId;
    this.pendingFocusEntityId = item.id;
    if (alreadyOpen) {
      this.scrollAndFocusEntity(item.id);
    }
  }

  /* --------------------------- taxonomy quick-add --------------------------- */

  /** S4-17: captures the trigger (the "Create new subcategory" icon button) so {@link closeTaxonomyForm} can return focus to it. */
  openTaxonomyForm(setter: (subcategoryId: string) => void): void {
    this.taxonomyTriggerEl = document.activeElement as HTMLElement | null;
    this.taxonomyFormOpen = true;
    this.taxonomyTarget = setter;
    this.taxonomyNewCategoryId = null;
    this.taxonomyNewCategoryName = '';
    this.taxonomyNewSubcategoryName = '';
  }

  cancelTaxonomyForm(): void {
    this.taxonomyTarget = null;
    this.closeTaxonomyForm();
  }

  /** S4-17: closes the dialog and returns focus to whatever opened it (Cancel, Escape, or a successful Create). */
  private closeTaxonomyForm(): void {
    this.taxonomyFormOpen = false;
    const trigger = this.taxonomyTriggerEl;
    this.taxonomyTriggerEl = null;
    if (trigger) {
      queueMicrotask(() => trigger.focus());
    }
  }

  /**
   * S4-17: a manual focus trap for the hand-rolled taxonomy dialog (no
   * cdkTrapFocus — see H-02/openTaxonomyForm's doc comment). Wraps Tab at
   * the last focusable element and Shift+Tab at the first.
   */
  /** Bound to `(keydown.tab)`, whose Angular template typing is the plain `Event` its filter dispatches from, not `KeyboardEvent`. */
  onTaxonomyDialogTab(domEvent: Event): void {
    const event = domEvent as KeyboardEvent;
    const container = event.currentTarget as HTMLElement;
    const focusable = this.getFocusableElements(container);
    if (!focusable.length) {
      event.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirstFocusable(container: HTMLElement): void {
    const focusable = this.getFocusableElements(container);
    (focusable[0] ?? container).focus();
  }

  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);
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
          this.closeTaxonomyForm();
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
