import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { AdminTaxonomyComponent } from './admin-taxonomy.component';
import { PacketAuthoringService } from '../../../packets/services/packet-authoring.service';
import { ConfirmDialogService } from '../../../shared/confirm-dialog/confirm-dialog.service';
import { Category, Difficulty, Subcategory } from '../../../packets/models/packet-authoring.models';
import { GraphqlRequestError } from '../../../core/graphql/graphql-errors';

describe('AdminTaxonomyComponent', () => {
  let component: AdminTaxonomyComponent;
  let fixture: ComponentFixture<AdminTaxonomyComponent>;
  let packetAuthoringSpy: jasmine.SpyObj<PacketAuthoringService>;
  let confirmDialogSpy: jasmine.SpyObj<ConfirmDialogService>;
  let snackBarSpy: jasmine.SpyObj<MatSnackBar>;

  const scienceId = 'cat-science';
  const historyId = 'cat-history';
  const biologyId = 'sub-biology';
  const easyId = 'diff-easy';
  const mediumId = 'diff-medium';

  function categories(): Category[] {
    return [
      { id: scienceId, name: 'Science' },
      { id: historyId, name: 'History' }
    ];
  }

  function subcategories(): Subcategory[] {
    return [{ id: biologyId, name: 'Biology', category: { id: scienceId, name: 'Science' } }];
  }

  function difficulties(): Difficulty[] {
    return [
      { id: easyId, name: 'Easy', description: 'Ages 8-11.' },
      { id: mediumId, name: 'Medium' }
    ];
  }

  function configure(): void {
    packetAuthoringSpy = jasmine.createSpyObj('PacketAuthoringService', [
      'getAllCategories',
      'getAllSubcategories',
      'getAllDifficulties',
      'createCategory',
      'createSubcategory',
      'createDifficulty',
      'renameCategory',
      'renameSubcategory',
      'renameDifficulty',
      'mergeCategories',
      'mergeSubcategories',
      'mergeDifficulties',
      'setDifficultyDescription'
    ]);
    packetAuthoringSpy.getAllCategories.and.returnValue(of(categories()));
    packetAuthoringSpy.getAllSubcategories.and.returnValue(of(subcategories()));
    packetAuthoringSpy.getAllDifficulties.and.returnValue(of(difficulties()));

    confirmDialogSpy = jasmine.createSpyObj('ConfirmDialogService', ['confirm']);
    snackBarSpy = jasmine.createSpyObj('MatSnackBar', ['open']);

    TestBed.configureTestingModule({
      declarations: [AdminTaxonomyComponent],
      providers: [
        { provide: PacketAuthoringService, useValue: packetAuthoringSpy },
        { provide: ConfirmDialogService, useValue: confirmDialogSpy },
        { provide: MatSnackBar, useValue: snackBarSpy }
      ],
      // Template uses Angular Material elements not declared in this unit test.
      schemas: [NO_ERRORS_SCHEMA]
    });
    fixture = TestBed.createComponent(AdminTaxonomyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('should create and load categories, subcategories and difficulties', () => {
    configure();
    expect(component).toBeTruthy();
    expect(component.categories.map((c) => c.id)).toEqual([historyId, scienceId]);
    expect(component.subcategories.length).toBe(1);
    expect(component.difficulties.length).toBe(2);
    expect(component.loading).toBeFalse();
  });

  describe('create', () => {
    it('adds a newly created category to the list', () => {
      configure();
      packetAuthoringSpy.createCategory.and.returnValue(of({ id: 'cat-new', name: 'Geography' }));

      component.newCategoryName = 'Geography';
      component.submitCreateCategory();

      expect(packetAuthoringSpy.createCategory).toHaveBeenCalledWith('Geography');
      expect(component.categories.some((c) => c.id === 'cat-new')).toBeTrue();
      expect(snackBarSpy.open).toHaveBeenCalledWith('Created "Geography"', 'Dismiss', jasmine.any(Object));
    });

    it('reports "already existed" when create returns an id already in the list', () => {
      configure();
      // The server dedupes case-insensitively and returns the existing node (plan 3.1.6).
      packetAuthoringSpy.createCategory.and.returnValue(of({ id: scienceId, name: 'Science' }));

      component.newCategoryName = 'science';
      component.submitCreateCategory();

      expect(snackBarSpy.open).toHaveBeenCalledWith('"Science" already existed', 'Dismiss', jasmine.any(Object));
      expect(component.categories.length).toBe(2);
    });

    it('reports "already existed" for a duplicate difficulty the same way', () => {
      configure();
      packetAuthoringSpy.createDifficulty.and.returnValue(of({ id: easyId, name: 'Easy' }));

      component.newDifficultyName = 'EASY';
      component.submitCreateDifficulty();

      expect(snackBarSpy.open).toHaveBeenCalledWith('"Easy" already existed', 'Dismiss', jasmine.any(Object));
      expect(component.difficulties.length).toBe(2);
    });

    it('reports "already existed" for a duplicate subcategory under its category', () => {
      configure();
      packetAuthoringSpy.createSubcategory.and.returnValue(
        of({ id: biologyId, name: 'Biology', category: { id: scienceId, name: 'Science' } })
      );

      const science = component.categories.find((c) => c.id === scienceId)!;
      component.newSubcategoryName = 'biology';
      component.submitCreateSubcategory(science);

      expect(snackBarSpy.open).toHaveBeenCalledWith(
        '"Biology" already existed under "Science"',
        'Dismiss',
        jasmine.any(Object)
      );
      expect(component.subcategories.length).toBe(1);
    });

    it('does nothing for a blank name', () => {
      configure();
      component.newCategoryName = '   ';
      component.submitCreateCategory();
      expect(packetAuthoringSpy.createCategory).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('renames a category on success', () => {
      configure();
      packetAuthoringSpy.renameCategory.and.returnValue(of({ id: scienceId, name: 'Natural Science' }));

      component.startRename('category', scienceId, 'Science');
      component.renaming!.draft = 'Natural Science';
      component.confirmRename();

      expect(packetAuthoringSpy.renameCategory).toHaveBeenCalledWith(scienceId, 'Natural Science');
      expect(component.categories.find((c) => c.id === scienceId)?.name).toBe('Natural Science');
      expect(component.renaming).toBeNull();
    });

    it('offers a merge when the rename collides with an existing name', () => {
      configure();
      const collisionError = new GraphqlRequestError({
        message: 'A category named "History" already exists. Merge instead?',
        classification: 'VALIDATION_FAILED'
      });
      packetAuthoringSpy.renameCategory.and.returnValue(throwError(() => collisionError));

      component.startRename('category', scienceId, 'Science');
      component.renaming!.draft = 'History';
      component.confirmRename();

      expect(component.collision).toEqual({
        kind: 'category',
        sourceId: scienceId,
        sourceName: 'Science',
        targetId: historyId,
        targetName: 'History'
      });
      // The rename field stays open so "Merge instead" can render next to it.
      expect(component.renaming).not.toBeNull();
    });

    it('falls back to the server message when a VALIDATION_FAILED collision matches no known node', () => {
      configure();
      const collisionError = new GraphqlRequestError({ message: 'not valid', classification: 'VALIDATION_FAILED' });
      packetAuthoringSpy.renameCategory.and.returnValue(throwError(() => collisionError));

      component.startRename('category', scienceId, 'Science');
      component.renaming!.draft = 'Some Unrelated Name';
      component.confirmRename();

      expect(component.collision).toBeNull();
      expect(snackBarSpy.open).toHaveBeenCalledWith('not valid', 'Dismiss', jasmine.any(Object));
    });

    it('shows a generic error for a non-collision failure', () => {
      configure();
      const forbidden = new GraphqlRequestError({ message: 'nope', classification: 'FORBIDDEN' });
      packetAuthoringSpy.renameCategory.and.returnValue(throwError(() => forbidden));

      component.startRename('category', scienceId, 'Science');
      component.renaming!.draft = 'Whatever';
      component.confirmRename();

      expect(component.collision).toBeNull();
      expect(snackBarSpy.open).toHaveBeenCalledWith(
        "You don't have permission to change this packet.",
        'Dismiss',
        jasmine.any(Object)
      );
    });

    it('scopes a subcategory rename collision to its own category', () => {
      configure();
      const collisionError = new GraphqlRequestError({ message: 'collides', classification: 'VALIDATION_FAILED' });
      packetAuthoringSpy.renameSubcategory.and.returnValue(throwError(() => collisionError));

      component.startRename('subcategory', biologyId, 'Biology', scienceId);
      component.renaming!.draft = 'Chemistry'; // no such subcategory exists yet -> no target found
      component.confirmRename();

      expect(component.collision).toBeNull();
      expect(snackBarSpy.open).toHaveBeenCalledWith('collides', 'Dismiss', jasmine.any(Object));
    });
  });

  describe('difficulty descriptions', () => {
    it('shows each description, or says there is none', () => {
      configure();
      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(component.difficulties.find((d) => d.id === easyId)?.description).toBe('Ages 8-11.');
      expect(text).toContain('Ages 8-11.');
      expect(text).toContain('No description: generation only gets the name.');
    });

    it('edits a description and keeps the saved text', () => {
      configure();
      packetAuthoringSpy.setDifficultyDescription.and.returnValue(
        of({ id: mediumId, name: 'Medium', description: 'Typical high school.' }));

      component.startDescribe(component.difficulties.find((d) => d.id === mediumId)!);
      expect(component.describing?.draft).toBe('');
      component.describing!.draft = '  Typical high school.  ';
      component.confirmDescribe();

      expect(packetAuthoringSpy.setDifficultyDescription).toHaveBeenCalledWith(mediumId, 'Typical high school.');
      expect(component.difficulties.find((d) => d.id === mediumId)?.description).toBe('Typical high school.');
      expect(component.describing).toBeNull();
    });

    it('keeps the editor open when saving fails', () => {
      configure();
      packetAuthoringSpy.setDifficultyDescription.and.returnValue(throwError(() => new Error('boom')));

      component.startDescribe(component.difficulties.find((d) => d.id === easyId)!);
      expect(component.describing?.draft).toBe('Ages 8-11.');
      component.confirmDescribe();

      expect(component.describing).not.toBeNull();
      expect(component.describingBusy).toBeFalse();
    });
  });

  describe('merge', () => {
    it('mergeFromCollision confirms and then calls mergeCategories with the collision pair', () => {
      configure();
      confirmDialogSpy.confirm.and.returnValue(of(true));
      packetAuthoringSpy.mergeCategories.and.returnValue(of({ id: historyId, name: 'History' }));

      component.collision = {
        kind: 'category',
        sourceId: scienceId,
        sourceName: 'Science',
        targetId: historyId,
        targetName: 'History'
      };

      component.mergeFromCollision();

      expect(confirmDialogSpy.confirm).toHaveBeenCalled();
      const dialogData = confirmDialogSpy.confirm.calls.mostRecent().args[0];
      expect(dialogData.message).toContain('Science');
      expect(dialogData.message).toContain('History');
      expect(dialogData.destructive).toBeTrue();
      expect(packetAuthoringSpy.mergeCategories).toHaveBeenCalledWith(scienceId, historyId);
      expect(component.categories.some((c) => c.id === scienceId)).toBeFalse();
    });

    it('the explicit merge picker confirms and then calls mergeCategories with the chosen target', () => {
      configure();
      confirmDialogSpy.confirm.and.returnValue(of(true));
      packetAuthoringSpy.mergeCategories.and.returnValue(of({ id: historyId, name: 'History' }));

      component.startMerge('category', scienceId, 'Science');
      component.merging!.targetId = historyId;
      component.confirmMergeSelected();

      expect(confirmDialogSpy.confirm).toHaveBeenCalled();
      expect(packetAuthoringSpy.mergeCategories).toHaveBeenCalledWith(scienceId, historyId);
      expect(component.categories.some((c) => c.id === scienceId)).toBeFalse();
    });

    it('does not merge when the confirm dialog is declined', () => {
      configure();
      confirmDialogSpy.confirm.and.returnValue(of(false));

      component.performMerge('category', scienceId, 'Science', historyId, 'History');

      expect(packetAuthoringSpy.mergeCategories).not.toHaveBeenCalled();
      expect(component.categories.some((c) => c.id === scienceId)).toBeTrue();
    });

    it('re-points a merged category\'s subcategories to the target', () => {
      configure();
      confirmDialogSpy.confirm.and.returnValue(of(true));
      packetAuthoringSpy.mergeCategories.and.returnValue(of({ id: historyId, name: 'History' }));

      component.performMerge('category', scienceId, 'Science', historyId, 'History');

      const moved = component.subcategories.find((s) => s.id === biologyId);
      expect(moved?.category?.id).toBe(historyId);
    });

    it('shows an error and keeps the source when the merge call fails', () => {
      configure();
      confirmDialogSpy.confirm.and.returnValue(of(true));
      packetAuthoringSpy.mergeCategories.and.returnValue(
        throwError(() => new GraphqlRequestError({ message: 'boom', classification: 'INTERNAL_ERROR' }))
      );

      component.performMerge('category', scienceId, 'Science', historyId, 'History');

      expect(component.categories.some((c) => c.id === scienceId)).toBeTrue();
      expect(snackBarSpy.open).toHaveBeenCalledWith('boom', 'Dismiss', jasmine.any(Object));
    });
  });

  describe('no delete control (D4)', () => {
    it('has no button, icon or method for deleting a taxonomy node', () => {
      configure();
      const root = fixture.nativeElement as HTMLElement;
      // No "delete" mat-icon and no button whose label names deletion — the
      // page's own explanatory copy ("there's no delete here...") legitimately
      // contains the word, so this checks for controls, not prose.
      const iconNames = Array.from(root.querySelectorAll('mat-icon')).map((el) => el.textContent?.trim());
      expect(iconNames).not.toContain('delete');
      const buttonLabels = Array.from(root.querySelectorAll('button')).map(
        (el) => el.getAttribute('aria-label')?.toLowerCase() ?? el.textContent?.toLowerCase() ?? ''
      );
      expect(buttonLabels.some((label) => label.includes('delete') || label.includes('remove'))).toBeFalse();

      expect((component as unknown as Record<string, unknown>)['deleteCategory']).toBeUndefined();
      expect((component as unknown as Record<string, unknown>)['deleteSubcategory']).toBeUndefined();
      expect((component as unknown as Record<string, unknown>)['deleteDifficulty']).toBeUndefined();
    });
  });
});
