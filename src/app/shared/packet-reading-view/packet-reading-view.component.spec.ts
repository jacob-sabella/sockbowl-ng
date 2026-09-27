import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PacketReadingViewComponent } from './packet-reading-view.component';

/**
 * PB-07 (M3 plan 3.3.3): the builder's "Preview" tab and the proctor's
 * dialog (`PacketPreviewComponent`) both render through this shared
 * component, so its ordering guarantees matter to both.
 */
describe('PacketReadingViewComponent', () => {
  let fixture: ComponentFixture<PacketReadingViewComponent>;
  let component: PacketReadingViewComponent;

  function makePacket(): any {
    return {
      tossups: [
        { order: 2, tossup: { question: 'Q3', answer: 'A3' } },
        { order: 0, tossup: { question: 'Q1', answer: 'A1' } },
        { order: 1, tossup: { question: 'Q2', answer: 'A2' } }
      ],
      bonuses: [
        {
          order: 1,
          bonus: {
            preamble: 'Second bonus preamble',
            bonusParts: [
              { order: 1, bonusPart: { question: 'BQ2', answer: 'BA2' } },
              { order: 0, bonusPart: { question: 'BQ1', answer: 'BA1' } }
            ]
          }
        },
        {
          order: 0,
          bonus: { preamble: 'First bonus preamble', bonusParts: [] }
        }
      ]
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PacketReadingViewComponent],
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(PacketReadingViewComponent);
    component = fixture.componentInstance;
  });

  it('sorts tossups by order regardless of input order', () => {
    component.packet = makePacket();
    expect(component.tossups.map(t => t.tossup.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('sorts bonuses by order regardless of input order', () => {
    component.packet = makePacket();
    expect(component.bonuses.map(b => b.bonus.preamble)).toEqual(['First bonus preamble', 'Second bonus preamble']);
  });

  it("sorts a bonus's parts by order", () => {
    component.packet = makePacket();
    const secondBonus = component.bonuses.find(b => b.bonus.preamble === 'Second bonus preamble')!;
    const parts = component.parts(secondBonus);
    expect(parts.map(p => p.bonusPart.question)).toEqual(['BQ1', 'BQ2']);
  });

  it('an empty bonus has no parts', () => {
    component.packet = makePacket();
    const firstBonus = component.bonuses.find(b => b.bonus.preamble === 'First bonus preamble')!;
    expect(component.parts(firstBonus)).toEqual([]);
  });

  it('renders tossups and bonus parts in order in the DOM', () => {
    component.packet = makePacket();
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent;
    expect(text.indexOf('Q1')).toBeGreaterThan(-1);
    expect(text.indexOf('Q1')).toBeLessThan(text.indexOf('Q2'));
    expect(text.indexOf('Q2')).toBeLessThan(text.indexOf('Q3'));
    expect(text.indexOf('BQ1')).toBeLessThan(text.indexOf('BQ2'));
  });

  it('handles a null packet without throwing', () => {
    component.packet = null;
    expect(component.tossups).toEqual([]);
    expect(component.bonuses).toEqual([]);
    expect(() => fixture.detectChanges()).not.toThrow();
  });
});
