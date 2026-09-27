import { fakeAsync, tick } from '@angular/core/testing';
import { RateLimitStateService } from './rate-limit-state.service';

describe('RateLimitStateService', () => {
  let state: RateLimitStateService;

  beforeEach(() => {
    state = new RateLimitStateService();
  });

  afterEach(() => {
    // Never leave a periodic timer running into the next spec.
    state.ngOnDestroy();
  });

  it('starts at 0 with no cooldown set', () => {
    expect(state.cooldown('session-create')()).toBe(0);
    expect(state.isCoolingDown('session-create')()).toBeFalse();
  });

  it('counts down to 0 and clears after the given seconds', fakeAsync(() => {
    state.setCooldown('session-create', 5);
    expect(state.cooldown('session-create')()).toBe(5);
    expect(state.isCoolingDown('session-create')()).toBeTrue();

    tick(5000);

    expect(state.cooldown('session-create')()).toBe(0);
    expect(state.isCoolingDown('session-create')()).toBeFalse();
  }));

  it('keeps different policies independent', () => {
    state.setCooldown('session-create', 5);
    expect(state.cooldown('ai-generate')()).toBe(0);
    expect(state.cooldown('session-create')()).toBe(5);
  });

  it('never shortens an existing cooldown with a smaller value', () => {
    state.setCooldown('import', 10);
    state.setCooldown('import', 2);
    expect(state.cooldown('import')()).toBe(10);
  });

  it('clearCooldown ends it immediately', () => {
    state.setCooldown('import', 10);
    state.clearCooldown('import');
    expect(state.cooldown('import')()).toBe(0);
  });

  it('ignores a non-positive duration', () => {
    state.setCooldown('import', 0);
    state.setCooldown('import', -5);
    expect(state.cooldown('import')()).toBe(0);
  });
});
