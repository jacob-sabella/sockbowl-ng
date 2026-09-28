import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { IpBanDialogComponent, IpBanDialogData } from './ip-ban-dialog.component';

describe('IpBanDialogComponent', () => {
  let fixture: ComponentFixture<IpBanDialogComponent>;
  let component: IpBanDialogComponent;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<IpBanDialogComponent>>;

  const data: IpBanDialogData = { cidr: '203.0.113.5' };

  function configure(): void {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [IpBanDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });

    fixture = TestBed.createComponent(IpBanDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('pre-fills the CIDR field from the injected data', () => {
    configure();
    expect(component.cidr).toBe('203.0.113.5');
  });

  it('confirm() rejects a malformed, edited CIDR without closing the dialog', () => {
    configure();
    component.cidr = '999.1.1.1';

    component.confirm();

    expect(component.cidrError).toContain('IPv4');
    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('confirm() closes with the trimmed CIDR, reason and TTL once valid', () => {
    configure();
    component.cidr = ' 203.0.113.0/24 ';
    component.reason = 'flood';
    component.ttlSeconds = 3600;

    component.confirm();

    expect(dialogRefSpy.close).toHaveBeenCalledWith({ cidr: '203.0.113.0/24', reason: 'flood', ttlSeconds: 3600 });
  });

  describe('CIDR error display (S5-04)', () => {
    it('onCidrChange sets the error live, for a non-empty malformed value, not just on submit', () => {
      configure();
      component.cidr = '999.1.1.1';

      component.onCidrChange();

      expect(component.cidrError).toContain('IPv4');
      expect(component.cidrErrorStateMatcher.isErrorState()).toBeTrue();
    });

    it('onCidrChange clears the error once corrected', () => {
      configure();
      component.cidr = '999.1.1.1';
      component.onCidrChange();

      component.cidr = '203.0.113.5';
      component.onCidrChange();

      expect(component.cidrError).toBeNull();
      expect(component.cidrErrorStateMatcher.isErrorState()).toBeFalse();
    });

    it('onCidrBlur flags an emptied field as required', () => {
      configure();
      component.cidr = '';

      component.onCidrBlur();

      expect(component.cidrError).toBeTruthy();
    });
  });

  it('a second confirm() call is a no-op once submitting (S5-16 double-submit guard)', () => {
    configure();

    component.confirm();
    dialogRefSpy.close.calls.reset();
    component.confirm();

    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('cancel() closes with no result', () => {
    configure();
    component.cancel();
    expect(dialogRefSpy.close).toHaveBeenCalledWith();
  });
});
