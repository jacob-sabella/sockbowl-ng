import { PacketDraftStore } from './packet-draft-store';

interface Fixture {
  question: string;
  answer: string;
}

describe('PacketDraftStore', () => {
  let store: PacketDraftStore<Fixture>;

  beforeEach(() => {
    store = new PacketDraftStore<Fixture>();
  });

  it('seeds fresh, clean drafts for new entities', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);

    expect(store.get('t1')).toEqual({ question: 'Q1', answer: 'A1' });
    expect(store.isDirty('t1')).toBeFalse();
    expect(store.dirtyCount).toBe(0);
  });

  it('marks a draft dirty and counts it', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.get('t1')!.question = 'Edited';
    store.markDirty('t1');

    expect(store.isDirty('t1')).toBeTrue();
    expect(store.dirtyCount).toBe(1);
  });

  it('PB-02 regression: reseeding after saving a different entity keeps this entity\'s edited value', () => {
    store.reseed([
      { id: 't3', value: { question: 'Q3', answer: 'A3' } },
      { id: 't5', value: { question: 'Q5', answer: 'A5' } }
    ]);

    // Edit tossup 3 but don't save it yet.
    store.get('t3')!.question = 'Q3 edited';
    store.markDirty('t3');

    // Tossup 5 gets saved and the packet is refetched, so both entities
    // reseed from the server's current state (t5's value now matches what
    // was saved; t3's server-side value hasn't changed).
    store.markSaved('t5');
    store.reseed([
      { id: 't3', value: { question: 'Q3', answer: 'A3' } },
      { id: 't5', value: { question: 'Q5', answer: 'A5' } }
    ]);

    expect(store.get('t3')).toEqual({ question: 'Q3 edited', answer: 'A3' });
    expect(store.isDirty('t3')).toBeTrue();
    expect(store.isDirty('t5')).toBeFalse();
  });

  it('drops drafts for entities no longer present', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.reseed([]);

    expect(store.has('t1')).toBeFalse();
    expect(store.ids()).toEqual([]);
  });

  it('gives a brand-new entity a fresh clean draft even while others stay dirty', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.get('t1')!.question = 'Edited';
    store.markDirty('t1');

    store.reseed([
      { id: 't1', value: { question: 'Q1', answer: 'A1' } },
      { id: 't2', value: { question: 'Q2', answer: 'A2' } }
    ]);

    expect(store.isDirty('t1')).toBeTrue();
    expect(store.get('t2')).toEqual({ question: 'Q2', answer: 'A2' });
    expect(store.isDirty('t2')).toBeFalse();
  });

  it('markSaved clears dirty and adopts the saved value as the new original', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.get('t1')!.question = 'Edited';
    store.markDirty('t1');
    store.markSaved('t1');

    expect(store.isDirty('t1')).toBeFalse();
    expect(store.getDraft('t1')?.original).toEqual({ question: 'Edited', answer: 'A1' });
  });

  it('revert restores the original value and clears dirty', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.get('t1')!.question = 'Edited';
    store.markDirty('t1');

    const reverted = store.revert('t1');

    expect(reverted).toEqual({ question: 'Q1', answer: 'A1' });
    expect(store.get('t1')).toEqual({ question: 'Q1', answer: 'A1' });
    expect(store.isDirty('t1')).toBeFalse();
  });

  it('dirtyIds returns only dirty ids, and dirtyCount matches its length', () => {
    store.reseed([
      { id: 't1', value: { question: 'Q1', answer: 'A1' } },
      { id: 't2', value: { question: 'Q2', answer: 'A2' } },
      { id: 't3', value: { question: 'Q3', answer: 'A3' } }
    ]);
    store.markDirty('t1');
    store.markDirty('t3');

    expect(store.dirtyIds()).toEqual(['t1', 't3']);
    expect(store.dirtyCount).toBe(2);
  });

  it('clear drops every tracked draft', () => {
    store.reseed([{ id: 't1', value: { question: 'Q1', answer: 'A1' } }]);
    store.clear();

    expect(store.ids()).toEqual([]);
  });
});
