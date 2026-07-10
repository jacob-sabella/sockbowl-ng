import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { forkJoin } from 'rxjs';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import {
  BonusElement,
  BonusPartElement,
  Packet,
  TossupElement
} from '../../../game/models/sockbowl/packet-types.generated';
import { Category, Difficulty, Subcategory } from '../../models/packet-authoring.models';
import { AuthService } from '../../../core/auth/auth.service';

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

interface SubcategoryGroup {
  category: string;
  subs: Subcategory[];
}

/**
 * Packet builder / editor. Loads the full packet graph, the difficulty
 * list, and the subcategory taxonomy on init, then lets an author edit the
 * packet's name/difficulty, tossups, and bonuses (with nested bonus parts)
 * in place. Every mutation refetches the packet afterward rather than
 * patching local state, matching the rest of the app's simple-service
 * pattern (no NgRx/state library).
 */
@Component({
  selector: 'app-packet-builder',
  templateUrl: './packet-builder.component.html',
  styleUrls: ['./packet-builder.component.scss'],
  standalone: false
})
export class PacketBuilderComponent implements OnInit {
  packetId = '';
  packet: Packet | null = null;
  loading = true;

  difficulties: Difficulty[] = [];
  categories: Category[] = [];
  allSubcategories: Subcategory[] = [];
  subcategoryGroups: SubcategoryGroup[] = [];

  // Header: inline name editing.
  editingName = false;
  nameDraft = '';
  savingName = false;

  // Tossup edit buffers, keyed by tossup entity id.
  tossupDrafts: { [tossupId: string]: TossupDraft } = {};
  newTossupOpen = false;
  newTossupDraft: TossupDraft = { question: '', answer: '', subcategoryId: null };
  addingTossup = false;

  // Bonus edit buffers, keyed by bonus entity id.
  bonusDrafts: { [bonusId: string]: BonusDraft } = {};
  addingBonus = false;
  justAddedBonusId: string | null = null;

  // Bonus part edit buffers, keyed by bonus part entity id.
  bonusPartDrafts: { [bonusPartId: string]: BonusPartDraft } = {};
  newPartOpen: { [bonusId: string]: boolean } = {};
  newPartDrafts: { [bonusId: string]: BonusPartDraft } = {};

  // AI-assist form.
  genOpen = false;
  genSubmitting = false;
  genDraft = { topic: '', additionalContext: '', subcategoryId: null as string | null };

  // Inline "create new subcategory" affordance, shared by every subcategory picker.
  taxonomyFormOpen = false;
  taxonomySubmitting = false;
  taxonomyNewCategoryId: string | null = null;
  taxonomyNewCategoryName = '';
  taxonomyNewSubcategoryName = '';
  private taxonomyTarget: ((subcategoryId: string) => void) | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private sockbowlQuestionsService: SockbowlQuestionsService,
    private packetAuthoring: PacketAuthoringService,
    private snackBar: MatSnackBar,
    public auth: AuthService
  ) {}

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
        this.packet = packet;
        this.difficulties = difficulties;
        this.categories = categories;
        this.allSubcategories = subcategories;
        this.rebuildSubcategoryGroups();
        this.seedDrafts();
        this.loading = false;
      },
      error: (err) => {
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
        this.loading = false;
      }
    });
  }

  /* ------------------------------- refetching ------------------------------ */

  private refetch(onDone?: () => void): void {
    this.sockbowlQuestionsService.getPacketById(this.packetId).subscribe({
      next: (packet) => {
        this.packet = packet;
        this.seedDrafts();
        onDone?.();
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  private seedDrafts(): void {
    if (!this.packet) {
      return;
    }
    this.packet.tossups.forEach(te => {
      this.tossupDrafts[te.tossup.id] = {
        question: te.tossup.question,
        answer: te.tossup.answer,
        subcategoryId: te.tossup.subcategory?.id ?? null
      };
    });
    this.packet.bonuses.forEach(be => {
      this.bonusDrafts[be.bonus.id] = {
        preamble: be.bonus.preamble ?? '',
        subcategoryId: be.bonus.subcategory?.id ?? null
      };
      be.bonus.bonusParts?.forEach(pe => {
        this.bonusPartDrafts[pe.bonusPart.id] = {
          question: pe.bonusPart.question,
          answer: pe.bonusPart.answer
        };
      });
    });
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
   * template: admins and packet:manage-any holders can manage any packet;
   * legacy/anonymous packets (no owner recorded) are managed by any
   * authoring-tier user (grandfather rule); otherwise only the owner.
   */
  get canManagePacket(): boolean {
    return this.auth.isAdmin()
      || this.auth.hasPermission('packet:manage-any')
      || !this.packet?.owner
      || this.packet.owner.id === this.auth.getCurrentUserId();
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
    this.packetAuthoring.renamePacket(this.packetId, name).subscribe({
      next: () => {
        this.savingName = false;
        this.editingName = false;
        this.refetch();
        this.snackBar.open('Name saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.savingName = false;
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  onDifficultyChange(difficultyId: string): void {
    this.packetAuthoring.setPacketDifficulty(this.packetId, difficultyId).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Difficulty saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  deletePacket(): void {
    if (!this.packet) {
      return;
    }
    if (!window.confirm(`Delete packet "${this.packet.name}"? This cannot be undone.`)) {
      return;
    }
    this.packetAuthoring.deletePacket(this.packetId).subscribe({
      next: () => {
        this.snackBar.open('Packet deleted', 'Dismiss', { duration: 2500 });
        this.router.navigate(['/packets']);
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  /* -------------------------------- tossups -------------------------------- */

  saveTossup(te: TossupElement): void {
    const draft = this.tossupDrafts[te.tossup.id];
    if (!draft) {
      return;
    }
    if (!draft.question.trim() || !draft.answer.trim()) {
      this.snackBar.open('Question and answer are both required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.packetAuthoring.updateTossup(te.tossup.id, {
      question: draft.question.trim(),
      answer: draft.answer.trim(),
      subcategoryId: draft.subcategoryId
    }).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Tossup saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  removeTossup(te: TossupElement): void {
    if (!window.confirm('Remove this tossup from the packet?')) {
      return;
    }
    this.packetAuthoring.removeTossupFromPacket(this.packetId, te.tossup.id).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Tossup removed', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  moveTossup(te: TossupElement, delta: number): void {
    const newOrder = te.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedTossups.length) {
      return;
    }
    this.packetAuthoring.reorderTossup(this.packetId, te.tossup.id, newOrder).subscribe({
      next: () => this.refetch(),
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
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
    }, null).subscribe({
      next: () => {
        this.addingTossup = false;
        this.newTossupOpen = false;
        this.refetch();
        this.snackBar.open('Tossup added', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.addingTossup = false;
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  /* ------------------------------ AI-assist tossup --------------------------- */

  openGenerate(): void {
    this.genOpen = true;
    this.genDraft = { topic: '', additionalContext: '', subcategoryId: null };
  }

  cancelGenerate(): void {
    this.genOpen = false;
  }

  generateTossup(): void {
    if (!this.genDraft.topic.trim()) {
      this.snackBar.open('A topic is required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.genSubmitting = true;
    this.packetAuthoring.generateAndAddTossup(this.packetId, {
      topic: this.genDraft.topic.trim(),
      additionalContext: this.genDraft.additionalContext.trim() || null,
      subcategoryId: this.genDraft.subcategoryId
    }, null).subscribe({
      next: () => {
        this.genSubmitting = false;
        this.genOpen = false;
        this.refetch();
        this.snackBar.open('Tossup generated', 'Dismiss', { duration: 2500 });
      },
      error: (err) => {
        this.genSubmitting = false;
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 5000 });
      }
    });
  }

  /* -------------------------------- bonuses -------------------------------- */

  saveBonus(be: BonusElement): void {
    const draft = this.bonusDrafts[be.bonus.id];
    if (!draft) {
      return;
    }
    this.packetAuthoring.updateBonus(be.bonus.id, {
      preamble: draft.preamble.trim() || null,
      subcategoryId: draft.subcategoryId
    }).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Bonus saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  removeBonus(be: BonusElement): void {
    if (!window.confirm('Remove this bonus (and its parts) from the packet?')) {
      return;
    }
    this.packetAuthoring.removeBonusFromPacket(this.packetId, be.bonus.id).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Bonus removed', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  moveBonus(be: BonusElement, delta: number): void {
    const newOrder = be.order + delta;
    if (newOrder < 0 || newOrder >= this.sortedBonuses.length) {
      return;
    }
    this.packetAuthoring.reorderBonus(this.packetId, be.bonus.id, newOrder).subscribe({
      next: () => this.refetch(),
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  addBonus(): void {
    this.addingBonus = true;
    // addBonusToPacket returns the affected Packet (per the mutation's
    // documented contract), not the new Bonus's own id, so the newly added
    // bonus is identified after refetch as the highest-order entry (order:
    // null always appends).
    this.packetAuthoring.addBonusToPacket(this.packetId, { preamble: '', subcategoryId: null, parts: [] }, null).subscribe({
      next: () => {
        this.addingBonus = false;
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
        this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
      }
    });
  }

  isJustAdded(be: BonusElement): boolean {
    return this.justAddedBonusId === be.bonus.id;
  }

  /* ------------------------------ bonus parts ------------------------------ */

  savePart(be: BonusElement, pe: BonusPartElement): void {
    const draft = this.bonusPartDrafts[pe.bonusPart.id];
    if (!draft) {
      return;
    }
    if (!draft.question.trim() || !draft.answer.trim()) {
      this.snackBar.open('Question and answer are both required', 'Dismiss', { duration: 3000 });
      return;
    }
    this.packetAuthoring.updateBonusPart(be.bonus.id, pe.bonusPart.id, {
      question: draft.question.trim(),
      answer: draft.answer.trim()
    }).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Bonus part saved', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  removePart(be: BonusElement, pe: BonusPartElement): void {
    if (!window.confirm('Remove this bonus part?')) {
      return;
    }
    this.packetAuthoring.removeBonusPart(be.bonus.id, pe.bonusPart.id).subscribe({
      next: () => {
        this.refetch();
        this.snackBar.open('Bonus part removed', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
    });
  }

  movePart(be: BonusElement, pe: BonusPartElement, delta: number): void {
    const parts = this.sortedParts(be);
    const newOrder = pe.order + delta;
    if (newOrder < 0 || newOrder >= parts.length) {
      return;
    }
    this.packetAuthoring.reorderBonusPart(be.bonus.id, pe.bonusPart.id, newOrder).subscribe({
      next: () => this.refetch(),
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
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
    }, null).subscribe({
      next: () => {
        this.newPartOpen[be.bonus.id] = false;
        this.refetch();
        this.snackBar.open('Bonus part added', 'Dismiss', { duration: 2500 });
      },
      error: (err) => this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 })
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
          this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
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
          this.snackBar.open(this.extractError(err), 'Dismiss', { duration: 4000 });
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

  subcategoryName(id: string | null | undefined): string {
    if (!id) {
      return '';
    }
    return this.allSubcategories.find(s => s.id === id)?.name || '';
  }

  extractError(err: any): string {
    return err?.error?.errors?.[0]?.message || 'Something went wrong.';
  }
}
