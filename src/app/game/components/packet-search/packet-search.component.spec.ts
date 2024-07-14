import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PacketSearchComponent } from './packet-search.component';

describe('PacketSearchComponent', () => {
  let component: PacketSearchComponent;
  let fixture: ComponentFixture<PacketSearchComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PacketSearchComponent]
    });
    fixture = TestBed.createComponent(PacketSearchComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
