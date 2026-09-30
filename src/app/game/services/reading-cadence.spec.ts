import { wordWeight } from './reading-cadence';

describe('wordWeight', () => {
  it('matches the server weights', () => {
    expect(wordWeight('the')).toBeCloseTo(0.75);
    expect(wordWeight('extraordinarily')).toBeCloseTo(1.35);
    expect(wordWeight('cat,')).toBeCloseTo(1.25);
    expect(wordWeight('cat.”')).toBeCloseTo(1.75);
  });
});
