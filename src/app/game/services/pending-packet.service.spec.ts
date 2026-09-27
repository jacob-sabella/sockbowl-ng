import { TestBed } from '@angular/core/testing';
import { PendingPacketService } from './pending-packet.service';

const STORAGE_KEY = 'sockbowl.pendingPacketId';

describe('PendingPacketService', () => {
  let service: PendingPacketService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PendingPacketService);
    sessionStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    // A preceding spec may have left sessionStorage.removeItem spied to
    // throw (Jasmine restores spies after this hook runs, not before).
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  it('has nothing pending initially', () => {
    expect(service.get()).toBeNull();
  });

  it('stores and returns a packet id', () => {
    service.set('packet-42');

    expect(service.get()).toBe('packet-42');
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('packet-42');
  });

  it('clears the stored packet id', () => {
    service.set('packet-42');

    service.clear();

    expect(service.get()).toBeNull();
  });

  it('tolerates set() when storage throws', () => {
    spyOn(sessionStorage, 'setItem').and.throwError('blocked');

    expect(() => service.set('packet-42')).not.toThrow();
  });

  it('tolerates get() when storage throws', () => {
    spyOn(sessionStorage, 'getItem').and.throwError('blocked');

    expect(service.get()).toBeNull();
  });

  it('tolerates clear() when storage throws', () => {
    spyOn(sessionStorage, 'removeItem').and.throwError('blocked');

    expect(() => service.clear()).not.toThrow();
  });
});
