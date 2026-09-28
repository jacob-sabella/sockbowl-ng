import { TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';

import { VersionCheckService } from './version-check.service';

describe('VersionCheckService (S6-11: the version-check snackbar renders once, readably)', () => {
  let service: VersionCheckService;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let onAction$: Subject<void>;
  let afterDismissed$: Subject<{ dismissedByAction: boolean }>;
  let snackBarRef: jasmine.SpyObj<MatSnackBarRef<TextOnlySnackBar>>;

  beforeEach(() => {
    onAction$ = new Subject<void>();
    afterDismissed$ = new Subject<{ dismissedByAction: boolean }>();
    snackBarRef = jasmine.createSpyObj('MatSnackBarRef', ['onAction', 'afterDismissed']);
    snackBarRef.onAction.and.returnValue(onAction$.asObservable());
    snackBarRef.afterDismissed.and.returnValue(afterDismissed$.asObservable());

    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);
    snackBarSpy.open.and.returnValue(snackBarRef);

    TestBed.configureTestingModule({
      providers: [{ provide: MatSnackBar, useValue: snackBarSpy }],
    });
    service = TestBed.inject(VersionCheckService);
  });

  it('offers a single readable snackbar with a Reload action', () => {
    service.offerReload();

    expect(snackBarSpy.open).toHaveBeenCalledTimes(1);
    const [message, action] = snackBarSpy.open.calls.mostRecent().args;
    expect(message).toBe('A new version of Sockbowl is available.');
    expect(action).toBe('Reload');
  });

  it('reloads the page when the action is taken', () => {
    // `location.reload` itself isn't spyable here (non-configurable native
    // property), so this spies on the service's own thin wrapper instead.
    const reloadSpy = spyOn(service as unknown as { reload(): void }, 'reload');
    service.offerReload();

    onAction$.next();

    expect(reloadSpy).toHaveBeenCalled();
  });

  it('start() no-ops under the dev server (no hashed bundle to compare against), so it never double-offers', () => {
    // `ng serve` (this harness's mode) serves an unhashed main.js, so
    // detectRunningBundle() finds nothing and start() returns early —
    // offerReload only ever fires through an explicit call (a real deploy
    // detection, or a capture's dev-mode hook), never spontaneously here.
    expect(() => service.start()).not.toThrow();
    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });
});
