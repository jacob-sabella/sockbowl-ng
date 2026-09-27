import { TestBed } from '@angular/core/testing';
import { AiKeyService } from './ai-key.service';

const STORAGE_KEY = 'openai_api_key';

describe('AiKeyService', () => {
  let service: AiKeyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiKeyService);
    localStorage.removeItem(STORAGE_KEY);
  });

  afterEach(() => {
    // A preceding spec may have left localStorage.removeItem spied to throw
    // (Jasmine restores spies after this hook runs, not before).
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  it('has nothing to load when no key was ever remembered', () => {
    expect(service.loadKey()).toBeNull();
  });

  it('remembers a key when asked to', () => {
    service.saveKey('sk-abc123', true);

    expect(service.loadKey()).toBe('sk-abc123');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sk-abc123');
  });

  it('does not remember a key when remember is false', () => {
    service.saveKey('sk-abc123', false);

    expect(service.loadKey()).toBeNull();
  });

  it('forgets a previously remembered key when remember turns off', () => {
    service.saveKey('sk-abc123', true);
    service.saveKey('sk-abc123', false);

    expect(service.loadKey()).toBeNull();
  });

  it('does not remember an empty key even when remember is true', () => {
    service.saveKey('', true);

    expect(service.loadKey()).toBeNull();
  });

  it('forgetKey clears a remembered key', () => {
    service.saveKey('sk-abc123', true);

    service.forgetKey();

    expect(service.loadKey()).toBeNull();
  });

  it('tolerates loadKey when storage throws', () => {
    spyOn(localStorage, 'getItem').and.throwError('blocked');

    expect(service.loadKey()).toBeNull();
  });

  it('tolerates saveKey when storage throws', () => {
    spyOn(localStorage, 'setItem').and.throwError('blocked');

    expect(() => service.saveKey('sk-abc123', true)).not.toThrow();
  });

  it('tolerates saveKey(remove) when storage throws', () => {
    spyOn(localStorage, 'removeItem').and.throwError('blocked');

    expect(() => service.saveKey('sk-abc123', false)).not.toThrow();
  });

  it('tolerates forgetKey when storage throws', () => {
    spyOn(localStorage, 'removeItem').and.throwError('blocked');

    expect(() => service.forgetKey()).not.toThrow();
  });
});
