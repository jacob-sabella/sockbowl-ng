/**
 * Per-card edit state for one builder instance (M3 plan 3.3.2). One
 * `PacketDraftStore` instance backs each of tossups, bonuses and bonus
 * parts; every entry is keyed by its entity id and holds `{value, original,
 * dirty}`. `value` is what the template's `[(ngModel)]` bindings mutate in
 * place; `original` is the last value known to match the server (either the
 * initial seed or the value just after a successful save).
 *
 * `reseed` is the fix for PB-02 ("saving one card wipes another card's
 * in-progress edit"): a dirty draft's `value` is left untouched across a
 * reseed (a refetch after some *other* entity's save), so only its
 * `original` moves forward. A clean draft has no in-progress edit to lose,
 * so both `value` and `original` adopt the fresh server value. An entity
 * no longer present in the reseed (removed elsewhere, e.g. in another tab)
 * has its draft dropped entirely.
 */
export interface Draft<T> {
  value: T;
  original: T;
  dirty: boolean;
}

export interface DraftEntitySource<T> {
  id: string;
  value: T;
}

function cloneValue<T>(value: T): T {
  const globalStructuredClone = (globalThis as { structuredClone?: <V>(v: V) => V }).structuredClone;
  if (typeof globalStructuredClone === 'function') {
    return globalStructuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export class PacketDraftStore<T> {
  private drafts = new Map<string, Draft<T>>();

  /** Every entity id currently tracked, in insertion order. */
  ids(): string[] {
    return Array.from(this.drafts.keys());
  }

  /** Every dirty entity id, in insertion order (used to build "Save all"'s worklist). */
  dirtyIds(): string[] {
    return this.ids().filter(id => this.isDirty(id));
  }

  has(id: string): boolean {
    return this.drafts.has(id);
  }

  /** The draft's current (possibly edited, unsaved) value, or `undefined` if there is no such entity. */
  get(id: string): T | undefined {
    return this.drafts.get(id)?.value;
  }

  /** The full draft record ({value, original, dirty}), for callers that need more than just the value. */
  getDraft(id: string): Draft<T> | undefined {
    return this.drafts.get(id);
  }

  isDirty(id: string): boolean {
    return this.drafts.get(id)?.dirty ?? false;
  }

  get dirtyCount(): number {
    let count = 0;
    this.drafts.forEach(draft => {
      if (draft.dirty) {
        count++;
      }
    });
    return count;
  }

  /**
   * Marks an entity's draft as edited. The template calls this (typically
   * from `(ngModelChange)`) right after mutating the object returned by
   * `get(id)` in place.
   */
  markDirty(id: string): void {
    const draft = this.drafts.get(id);
    if (draft) {
      draft.dirty = true;
    }
  }

  /**
   * Marks an entity clean after a successful save: `original` adopts the
   * just-saved `value`, and `dirty` clears. Called before the post-save
   * refetch's `reseed` so a fast reseed (or one that doesn't yet reflect the
   * save server-side) doesn't leave the card looking dirty.
   */
  markSaved(id: string): void {
    const draft = this.drafts.get(id);
    if (draft) {
      draft.original = cloneValue(draft.value);
      draft.dirty = false;
    }
  }

  /** Discards the in-progress edit, restoring `value` to `original` and clearing `dirty`. */
  revert(id: string): T | undefined {
    const draft = this.drafts.get(id);
    if (!draft) {
      return undefined;
    }
    draft.value = cloneValue(draft.original);
    draft.dirty = false;
    return draft.value;
  }

  /**
   * Reseeds from the latest server-known entities (typically right after a
   * refetch):
   *  - an id no longer present is dropped;
   *  - a new id gets a fresh, clean draft;
   *  - an existing **dirty** draft keeps `value` as-is and only moves
   *    `original` forward (PB-02 — this is the whole point of this class);
   *  - an existing **clean** draft adopts the fresh value as both `value`
   *    and `original`.
   */
  reseed(entities: DraftEntitySource<T>[]): void {
    const seenIds = new Set(entities.map(e => e.id));
    for (const id of this.ids()) {
      if (!seenIds.has(id)) {
        this.drafts.delete(id);
      }
    }
    for (const { id, value } of entities) {
      const existing = this.drafts.get(id);
      if (!existing) {
        this.drafts.set(id, { value: cloneValue(value), original: cloneValue(value), dirty: false });
      } else if (existing.dirty) {
        existing.original = cloneValue(value);
      } else {
        existing.value = cloneValue(value);
        existing.original = cloneValue(value);
      }
    }
  }

  /** Drops every tracked draft (e.g. when the builder navigates to a different packet id). */
  clear(): void {
    this.drafts.clear();
  }
}
