import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { PacketImportDialogComponent } from './packet-import-dialog.component';
import { PacketAuthoringService } from '../../services/packet-authoring.service';
import { SockbowlQuestionsService } from '../../../game/services/sockbowl-questions.service';
import { ImportPacketResult } from '../../models/packet-authoring.models';
import { IMPORT_MAX_BYTES } from '../../models/packet-limits';
import { GraphqlRequestError } from '../../../core/graphql/graphql-errors';

describe('PacketImportDialogComponent', () => {
  let fixture: ComponentFixture<PacketImportDialogComponent>;
  let component: PacketImportDialogComponent;
  let authoringSpy: jasmine.SpyObj<PacketAuthoringService>;
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<PacketImportDialogComponent>>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;
  let router: jasmine.SpyObj<Router>;

  const cleanResult: ImportPacketResult = {
    committed: false,
    packet: null,
    parsed: {
      suggestedName: 'Parsed Packet',
      tossups: [
        { line: 1, question: 'Q1', answer: 'A1' },
        { line: 3, question: 'Q2', answer: 'A2' }
      ],
      bonuses: []
    },
    issues: []
  };

  const errorResult: ImportPacketResult = {
    committed: false,
    packet: null,
    parsed: { suggestedName: null, tossups: [], bonuses: [] },
    issues: [
      { severity: 'ERROR', line: 5, message: 'Tossup 2 is missing an answer' },
      { severity: 'WARNING', line: 9, message: 'Unrecognized category tag' }
    ]
  };

  function configure(): void {
    authoringSpy = jasmine.createSpyObj('PacketAuthoringService', ['getAllDifficulties', 'importPacket']);
    authoringSpy.getAllDifficulties.and.returnValue(of([]));

    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [PacketImportDialogComponent],
      providers: [
        { provide: PacketAuthoringService, useValue: authoringSpy },
        { provide: SockbowlQuestionsService, useValue: jasmine.createSpyObj('SockbowlQuestionsService', ['listPackets', 'exportPacket']) },
        { provide: MatDialogRef, useValue: dialogRefSpy },
        { provide: MatSnackBar, useValue: snackBarSpy },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });

    fixture = TestBed.createComponent(PacketImportDialogComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    fixture.detectChanges();
  }

  function fileOfSize(bytes: number, name = 'packet.txt'): File {
    return new File([new Uint8Array(bytes)], name, { type: 'text/plain' });
  }

  function fileSelectEvent(file: File | undefined): Event {
    return { target: { files: file ? [file] : [], value: '' } } as unknown as Event;
  }

  it('rejects a file over 512 KiB client-side without reading it', () => {
    configure();
    const bigFile = fileOfSize(IMPORT_MAX_BYTES + 1, 'huge.txt');
    component.onFileSelected(fileSelectEvent(bigFile));

    expect(component.fileError).toContain('huge.txt');
    expect(component.selectedFileName).toBeNull();
    expect(component.text).toBe('');
  });

  it('accepts a file at or under the limit', (done) => {
    configure();
    const okFile = fileOfSize(1024, 'ok.txt');
    component.onFileSelected(fileSelectEvent(okFile));

    // FileReader resolves asynchronously even for an in-memory Blob.
    setTimeout(() => {
      expect(component.fileError).toBeNull();
      expect(component.selectedFileName).toBe('ok.txt');
      done();
    }, 50);
  });

  it('preview calls importPacket with dryRun:true and renders issues with line numbers', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(errorResult));
    component.text = '1. A tossup...';
    component.preview();

    expect(authoringSpy.importPacket).toHaveBeenCalledWith(
      jasmine.objectContaining({ text: '1. A tossup...', dryRun: true })
    );
    expect(component.step).toBe('preview');

    fixture.detectChanges();
    const rendered = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(rendered).toContain('Line 5');
    expect(rendered).toContain('Tossup 2 is missing an answer');
    expect(rendered).toContain('Line 9');
  });

  it('prefills the name from suggestedName when the user has not typed one', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(cleanResult));
    component.text = 'some text';
    component.preview();
    expect(component.name).toBe('Parsed Packet');
  });

  it('does not overwrite a name the user already typed', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(cleanResult));
    component.text = 'some text';
    component.name = 'My chosen name';
    component.preview();
    expect(component.name).toBe('My chosen name');
  });

  it('disables Import while ERROR issues exist, unless "skip invalid" is checked', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(errorResult));
    component.text = 'bad packet text';
    component.preview();

    expect(component.canImport).toBeFalse();

    component.skipInvalid = true;
    expect(component.canImport).toBeTrue();
  });

  it('allows Import when the preview has only warnings/info (no errors)', () => {
    configure();
    const warningOnly: ImportPacketResult = {
      ...cleanResult,
      issues: [{ severity: 'WARNING', line: 2, message: 'heads up' }]
    };
    authoringSpy.importPacket.and.returnValue(of(warningOnly));
    component.text = 'ok text';
    component.preview();

    expect(component.canImport).toBeTrue();
  });

  it('on success, commits with dryRun:false and navigates to the new packet\'s builder', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(cleanResult));
    component.text = 'clean packet text';
    component.name = 'Imported';
    component.preview();

    authoringSpy.importPacket.and.returnValue(
      of({ committed: true, packet: { id: 'new-id' }, parsed: cleanResult.parsed, issues: [] })
    );
    component.import();

    expect(authoringSpy.importPacket).toHaveBeenCalledWith(
      jasmine.objectContaining({ dryRun: false, skipInvalid: false })
    );
    expect(dialogRefSpy.close).toHaveBeenCalledWith({ packetId: 'new-id' });
    expect(router.navigate).toHaveBeenCalledWith(['/packets', 'new-id', 'edit']);
  });

  it('surfaces a typed GraphQL error on preview failure instead of throwing', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(throwError(() => new Error('boom')));
    component.text = 'some text';
    expect(() => component.preview()).not.toThrow();
    expect(component.previewing).toBeFalse();
  });

  // INT1 (single-snackbar rule): importPacket is wrapped in the `imports`
  // quota and `import`/`import-ip` rate limits (M4-plan INT1), and
  // GraphqlClientService's notifyLimit already shows the canonical snackbar
  // for RATE_LIMITED/QUOTA_EXCEEDED/BANNED (describeGraphqlError maps them to
  // ''), so this dialog must not open a second, empty one.
  it('a RATE_LIMITED preview failure does not open a second (empty) snackbar', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(
      throwError(() => new GraphqlRequestError({ message: 'Too many requests', classification: 'RATE_LIMITED' }))
    );
    component.text = 'some text';
    component.preview();

    expect(component.previewing).toBeFalse();
    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });

  it('a QUOTA_EXCEEDED import commit failure does not open a second (empty) snackbar', () => {
    configure();
    authoringSpy.importPacket.and.returnValue(of(cleanResult));
    component.text = 'clean packet text';
    component.preview();

    authoringSpy.importPacket.and.returnValue(
      throwError(() => new GraphqlRequestError({ message: 'Quota used up', classification: 'QUOTA_EXCEEDED' }))
    );
    component.import();

    expect(component.importing).toBeFalse();
    expect(snackBarSpy.open).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog without importing', () => {
    configure();
    component.cancel();
    expect(dialogRefSpy.close).toHaveBeenCalledWith();
    expect(authoringSpy.importPacket).not.toHaveBeenCalled();
  });
});
