import { Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { PacketAuthoringService } from '../../../packets/services/packet-authoring.service';
import { Category, Difficulty, Subcategory } from '../../../packets/models/packet-authoring.models';
import { GraphqlRequestError, describeGraphqlError } from '../../../core/graphql/graphql-errors';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';

/** The three taxonomy node kinds this page manages (M3 plan 3.1.6 / 3.3.6). */
type TaxonomyKind = 'category' | 'subcategory' | 'difficulty';

interface RenameState {
  kind: TaxonomyKind;
  id: string;
  /** The category a subcategory belongs to; unused for the other kinds. */
  categoryId?: string;
  draft: string;
}

/** Shown inline under a rename field after the server rejects it as a name collision. */
interface CollisionOffer {
  kind: TaxonomyKind;
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
}

interface MergeState {
  kind: TaxonomyKind;
  sourceId: string;
  sourceName: string;
  /** The category subcategories are scoped to; unused for the other kinds. */
  categoryId?: string;
  targetId: string;
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * `/admin/taxonomy` (`taxonomy:manage`, moderator/admin per D4): Categories
 * (expandable to their subcategories) and Difficulties, each with create
 * (dedupes silently server-side; this page reports "already existed" when
 * the returned node's id was already in the list), inline rename (a name
 * collision offers "Merge instead" rather than failing silently), and an
 * explicit merge picker. There is no delete (M3 plan 3.1.6 / 3.3.6, PB-10):
 * an unwanted node is always merged into another, never removed outright.
 */
@Component({
  selector: 'app-admin-taxonomy',
  templateUrl: './admin-taxonomy.component.html',
  styleUrls: ['./admin-taxonomy.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false
})
export class AdminTaxonomyComponent implements OnInit {
  private packetAuthoringService = inject(PacketAuthoringService);
  private snackBar = inject(MatSnackBar);
  private confirmDialogService = inject(ConfirmDialogService);

  categories: Category[] = [];
  subcategories: Subcategory[] = [];
  difficulties: Difficulty[] = [];

  loading = true;
  loadError: string | null = null;

  expandedCategoryId: string | null = null;

  newCategoryName = '';
  newDifficultyName = '';
  newSubcategoryName = '';
  creatingCategory = false;
  creatingDifficulty = false;
  creatingSubcategory = false;

  renaming: RenameState | null = null;
  renamingBusy = false;
  collision: CollisionOffer | null = null;

  merging: MergeState | null = null;
  mergingBusy = false;

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.loadError = null;
    forkJoin({
      categories: this.packetAuthoringService.getAllCategories(),
      subcategories: this.packetAuthoringService.getAllSubcategories(),
      difficulties: this.packetAuthoringService.getAllDifficulties()
    }).subscribe({
      next: ({ categories, subcategories, difficulties }) => {
        this.categories = [...categories].sort(byName);
        this.subcategories = [...subcategories].sort(byName);
        this.difficulties = [...difficulties].sort(byName);
        this.loading = false;
      },
      error: (err) => {
        this.loadError = describeGraphqlError(err);
        this.loading = false;
      }
    });
  }

  /* --------------------------------- display -------------------------------- */

  subcategoriesFor(categoryId: string): Subcategory[] {
    return this.subcategories.filter((s) => s.category?.id === categoryId);
  }

  toggleCategory(categoryId: string): void {
    this.expandedCategoryId = this.expandedCategoryId === categoryId ? null : categoryId;
    this.newSubcategoryName = '';
    this.cancelRename();
    this.cancelMerge();
  }

  /* ---------------------------------- create --------------------------------- */

  submitCreateCategory(): void {
    const name = this.newCategoryName.trim();
    if (!name || this.creatingCategory) {
      return;
    }
    const existingIds = new Set(this.categories.map((c) => c.id));
    this.creatingCategory = true;
    this.packetAuthoringService.createCategory(name).subscribe({
      next: (category) => {
        this.creatingCategory = false;
        this.newCategoryName = '';
        if (existingIds.has(category.id)) {
          this.snackBar.open(`"${category.name}" already existed`, 'Dismiss', { duration: 3000 });
          return;
        }
        this.categories = [...this.categories, category].sort(byName);
        this.snackBar.open(`Created "${category.name}"`, 'Dismiss', { duration: 3000 });
      },
      error: (err) => {
        this.creatingCategory = false;
        this.snackBar.open(describeGraphqlError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  submitCreateDifficulty(): void {
    const name = this.newDifficultyName.trim();
    if (!name || this.creatingDifficulty) {
      return;
    }
    const existingIds = new Set(this.difficulties.map((d) => d.id));
    this.creatingDifficulty = true;
    this.packetAuthoringService.createDifficulty(name).subscribe({
      next: (difficulty) => {
        this.creatingDifficulty = false;
        this.newDifficultyName = '';
        if (existingIds.has(difficulty.id)) {
          this.snackBar.open(`"${difficulty.name}" already existed`, 'Dismiss', { duration: 3000 });
          return;
        }
        this.difficulties = [...this.difficulties, difficulty].sort(byName);
        this.snackBar.open(`Created "${difficulty.name}"`, 'Dismiss', { duration: 3000 });
      },
      error: (err) => {
        this.creatingDifficulty = false;
        this.snackBar.open(describeGraphqlError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  submitCreateSubcategory(category: Category): void {
    const name = this.newSubcategoryName.trim();
    if (!name || this.creatingSubcategory) {
      return;
    }
    const existingIds = new Set(this.subcategoriesFor(category.id).map((s) => s.id));
    this.creatingSubcategory = true;
    this.packetAuthoringService.createSubcategory(name, category.id).subscribe({
      next: (subcategory) => {
        this.creatingSubcategory = false;
        this.newSubcategoryName = '';
        if (existingIds.has(subcategory.id)) {
          this.snackBar.open(`"${subcategory.name}" already existed under "${category.name}"`, 'Dismiss', {
            duration: 3000
          });
          return;
        }
        this.subcategories = [...this.subcategories, subcategory].sort(byName);
        this.snackBar.open(`Created "${subcategory.name}"`, 'Dismiss', { duration: 3000 });
      },
      error: (err) => {
        this.creatingSubcategory = false;
        this.snackBar.open(describeGraphqlError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  /* ---------------------------------- rename --------------------------------- */

  startRename(kind: TaxonomyKind, id: string, currentName: string, categoryId?: string): void {
    this.renaming = { kind, id, categoryId, draft: currentName };
    this.collision = null;
    this.merging = null;
  }

  cancelRename(): void {
    this.renaming = null;
    this.collision = null;
  }

  confirmRename(): void {
    if (!this.renaming || this.renamingBusy) {
      return;
    }
    const { kind, id, draft } = this.renaming;
    const name = draft.trim();
    if (!name) {
      return;
    }
    this.renamingBusy = true;
    this.renameRequest(kind, id, name).subscribe({
      next: (updated) => {
        this.renamingBusy = false;
        this.applyRename(kind, id, updated);
        this.snackBar.open(`Renamed to "${updated.name}"`, 'Dismiss', { duration: 3000 });
        this.renaming = null;
        this.collision = null;
      },
      error: (err) => {
        this.renamingBusy = false;
        if (err instanceof GraphqlRequestError && err.classification === 'VALIDATION_FAILED') {
          const target = this.findCollisionTarget(kind, id, name, this.renaming?.categoryId);
          if (target) {
            this.collision = {
              kind,
              sourceId: id,
              sourceName: this.currentNameFor(kind, id),
              targetId: target.id,
              targetName: target.name
            };
            return;
          }
        }
        this.snackBar.open(describeGraphqlError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  /** Invoked from the "Merge instead" offer shown after a rename collision. */
  mergeFromCollision(): void {
    if (!this.collision) {
      return;
    }
    const { kind, sourceId, sourceName, targetId, targetName } = this.collision;
    this.collision = null;
    this.renaming = null;
    this.performMerge(kind, sourceId, sourceName, targetId, targetName);
  }

  private renameRequest(kind: TaxonomyKind, id: string, name: string) {
    switch (kind) {
      case 'category':
        return this.packetAuthoringService.renameCategory(id, name);
      case 'subcategory':
        return this.packetAuthoringService.renameSubcategory(id, name);
      case 'difficulty':
        return this.packetAuthoringService.renameDifficulty(id, name);
      default:
        throw new Error(`Unknown taxonomy kind: ${kind as string}`);
    }
  }

  private applyRename(kind: TaxonomyKind, id: string, updated: Category | Subcategory | Difficulty): void {
    if (kind === 'category') {
      this.categories = this.categories.map((c) => (c.id === id ? (updated as Category) : c)).sort(byName);
    } else if (kind === 'subcategory') {
      this.subcategories = this.subcategories
        .map((s) => (s.id === id ? (updated as Subcategory) : s))
        .sort(byName);
    } else {
      this.difficulties = this.difficulties.map((d) => (d.id === id ? (updated as Difficulty) : d)).sort(byName);
    }
  }

  private currentNameFor(kind: TaxonomyKind, id: string): string {
    const list = kind === 'category' ? this.categories : kind === 'subcategory' ? this.subcategories : this.difficulties;
    return list.find((item) => item.id === id)?.name ?? '';
  }

  /** The existing node (other than `sourceId`) whose name collides with `draftName`, if any. */
  private findCollisionTarget(
    kind: TaxonomyKind,
    sourceId: string,
    draftName: string,
    categoryId?: string
  ): { id: string; name: string } | undefined {
    const key = normalizeKey(draftName);
    if (kind === 'category') {
      return this.categories.find((c) => c.id !== sourceId && normalizeKey(c.name) === key);
    }
    if (kind === 'difficulty') {
      return this.difficulties.find((d) => d.id !== sourceId && normalizeKey(d.name) === key);
    }
    // Subcategories only collide within the same category (server rejects
    // cross-category subcategory merges, plan 3.1.6).
    const scoped = categoryId ? this.subcategoriesFor(categoryId) : this.subcategories;
    return scoped.find((s) => s.id !== sourceId && normalizeKey(s.name) === key);
  }

  /* ---------------------------------- merge ---------------------------------- */

  mergeCandidatesFor(kind: TaxonomyKind, sourceId: string, categoryId?: string): { id: string; name: string }[] {
    if (kind === 'category') {
      return this.categories.filter((c) => c.id !== sourceId);
    }
    if (kind === 'difficulty') {
      return this.difficulties.filter((d) => d.id !== sourceId);
    }
    const scoped = categoryId ? this.subcategoriesFor(categoryId) : this.subcategories;
    return scoped.filter((s) => s.id !== sourceId);
  }

  startMerge(kind: TaxonomyKind, id: string, name: string, categoryId?: string): void {
    this.merging = { kind, sourceId: id, sourceName: name, categoryId, targetId: '' };
    this.renaming = null;
    this.collision = null;
  }

  cancelMerge(): void {
    this.merging = null;
  }

  confirmMergeSelected(): void {
    if (!this.merging || !this.merging.targetId) {
      return;
    }
    const { kind, sourceId, sourceName, targetId, categoryId } = this.merging;
    const targetName = this.mergeCandidatesFor(kind, sourceId, categoryId).find((t) => t.id === targetId)?.name ?? '';
    this.merging = null;
    this.performMerge(kind, sourceId, sourceName, targetId, targetName);
  }

  /** Confirms, then merges `sourceId` into `targetId` and drops the source from the local lists. */
  performMerge(kind: TaxonomyKind, sourceId: string, sourceName: string, targetId: string, targetName: string): void {
    this.confirmDialogService
      .confirm({
        title: 'Merge taxonomy',
        message: `Merge "${sourceName}" into "${targetName}"? Everything under "${sourceName}" moves to "${targetName}", and "${sourceName}" is deleted.`,
        confirmText: 'Merge',
        destructive: true
      })
      .subscribe((confirmed) => {
        if (!confirmed) {
          return;
        }
        this.mergingBusy = true;
        this.mergeRequest(kind, sourceId, targetId).subscribe({
          next: (target) => {
            this.mergingBusy = false;
            this.applyMerge(kind, sourceId, target);
            this.snackBar.open(`Merged "${sourceName}" into "${target.name}"`, 'Dismiss', { duration: 3000 });
          },
          error: (err) => {
            this.mergingBusy = false;
            this.snackBar.open(describeGraphqlError(err), 'Dismiss', { duration: 4000 });
          }
        });
      });
  }

  private mergeRequest(kind: TaxonomyKind, sourceId: string, targetId: string) {
    switch (kind) {
      case 'category':
        return this.packetAuthoringService.mergeCategories(sourceId, targetId);
      case 'subcategory':
        return this.packetAuthoringService.mergeSubcategories(sourceId, targetId);
      case 'difficulty':
        return this.packetAuthoringService.mergeDifficulties(sourceId, targetId);
      default:
        throw new Error(`Unknown taxonomy kind: ${kind as string}`);
    }
  }

  private applyMerge(kind: TaxonomyKind, sourceId: string, target: Category | Subcategory | Difficulty): void {
    if (kind === 'category') {
      this.categories = this.categories.filter((c) => c.id !== sourceId);
      // The source's subcategories move to the target (plan 3.1.6).
      this.subcategories = this.subcategories.map((s) =>
        s.category?.id === sourceId ? { ...s, category: target as Category } : s
      );
      if (this.expandedCategoryId === sourceId) {
        this.expandedCategoryId = target.id;
      }
    } else if (kind === 'subcategory') {
      this.subcategories = this.subcategories.filter((s) => s.id !== sourceId);
    } else {
      this.difficulties = this.difficulties.filter((d) => d.id !== sourceId);
    }
  }
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}
