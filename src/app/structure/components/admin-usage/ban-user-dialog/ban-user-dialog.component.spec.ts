import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { BanUserDialogComponent, BanUserDialogData, USER_BAN_EXPIRY_OPTIONS } from './ban-user-dialog.component';

describe('BanUserDialogComponent', () => {
  let fixture: ComponentFixture<BanUserDialogComponent>;
  let component: BanUserDialogComponent;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<BanUserDialogComponent>>;

  const data: BanUserDialogData = { keycloakId: 'user-1', displayName: 'Jane Doe' };

  function configure(): void {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [BanUserDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });

    fixture = TestBed.createComponent(BanUserDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('defaults the expiry to 7 days, not Permanent (S5-03)', () => {
    configure();
    expect(component.expirySeconds).toBe(604800);
  });

  it('confirm() computes an ISO expiresAt from the chosen expiry', () => {
    configure();
    component.reason = 'spam';
    component.expirySeconds = 3600;

    component.confirm();

    const result = dialogRefSpy.close.calls.mostRecent().args[0];
    expect(result.bannedKeycloakId).toBe('user-1');
    expect(result.reason).toBe('spam');
    expect(result.expiresAt).not.toBeNull();
    const minutes = (new Date(result.expiresAt as string).getTime() - Date.now()) / 60000;
    expect(minutes).toBeCloseTo(60, 0);
  });

  it('confirm() sends expiresAt: null only when Permanent is chosen', () => {
    configure();
    component.expirySeconds = null;

    component.confirm();

    expect(dialogRefSpy.close).toHaveBeenCalledWith(jasmine.objectContaining({ expiresAt: null }));
  });

  it('cancel() closes with no result', () => {
    configure();
    component.cancel();
    expect(dialogRefSpy.close).toHaveBeenCalledWith();
  });

  it('a second confirm() call is a no-op once submitting (S5-16 double-submit guard)', () => {
    configure();

    component.confirm();
    dialogRefSpy.close.calls.reset();
    component.confirm();

    expect(dialogRefSpy.close).not.toHaveBeenCalled();
  });

  it('exposes the Permanent option alongside the timed choices', () => {
    configure();
    expect(component.expiryOptions).toBe(USER_BAN_EXPIRY_OPTIONS);
    expect(USER_BAN_EXPIRY_OPTIONS.some((o) => o.label === 'Permanent' && o.seconds === null)).toBeTrue();
  });
});
