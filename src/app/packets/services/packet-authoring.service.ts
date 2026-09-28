import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { GraphqlClientService } from '../../core/graphql/graphql-client.service';
import {
  BonusInput,
  BonusPartInput,
  BonusUpdateInput,
  Category,
  Difficulty,
  GenerateTossupInput,
  ImportPacketInput,
  ImportPacketResult,
  Subcategory,
  TossupInput,
  CreatePacketInput,
  PacketVisibility
} from '../models/packet-authoring.models';

/**
 * All packet authoring mutations plus the 3 taxonomy list queries, over the
 * same GraphQL endpoint used by SockbowlQuestionsService, routed through the
 * shared {@link GraphqlClientService} so every failure surfaces as a typed
 * `GraphqlRequestError` instead of being swallowed (PB-01, M3 plan 3.3.1).
 *
 * Every content mutation (anything that reads or writes a packet's tossups,
 * bonuses, bonus parts or visibility) takes an optional trailing
 * `expectedVersion`, mirroring the server's optimistic-locking argument
 * (M3 plan 3.1.4). Omitting it skips the version check, matching the
 * server's default. Most mutations only request `{ id }` back (or a bare
 * boolean for `deletePacket`) since the calling component always refetches
 * the full packet via `SockbowlQuestionsService.getPacketById()` right
 * after a successful call.
 */
@Injectable({
  providedIn: 'root'
})
export class PacketAuthoringService {
  private client = inject(GraphqlClientService);

  private graphqlUrl: string = environment.sockbowlQuestionsApiUrl + 'graphql';

  private post<T>(query: string, variables: Record<string, unknown>, timeoutMs?: number): Observable<T> {
    return this.client.request<T>(this.graphqlUrl, query, variables, timeoutMs ? { timeoutMs } : undefined);
  }

  /* --------------------------- taxonomy queries --------------------------- */

  getAllDifficulties(): Observable<Difficulty[]> {
    const query = `query { getAllDifficulties { id name } }`;
    return this.post<{ getAllDifficulties: Difficulty[] }>(query, {}).pipe(
      map(d => d.getAllDifficulties)
    );
  }

  getAllCategories(): Observable<Category[]> {
    const query = `query { getAllCategories { id name } }`;
    return this.post<{ getAllCategories: Category[] }>(query, {}).pipe(
      map(d => d.getAllCategories)
    );
  }

  getAllSubcategories(): Observable<Subcategory[]> {
    const query = `query { getAllSubcategories { id name category { id name } } }`;
    return this.post<{ getAllSubcategories: Subcategory[] }>(query, {}).pipe(
      map(d => d.getAllSubcategories)
    );
  }

  /* ------------------------------ packet CRUD ------------------------------ */

  createPacket(input: CreatePacketInput): Observable<string> {
    const query = `
      mutation ($input: CreatePacketInput!) {
        createPacket(input: $input) { id }
      }
    `;
    return this.post<{ createPacket: { id: string } }>(query, { input }).pipe(
      map(d => d.createPacket.id)
    );
  }

  renamePacket(id: string, name: string, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $name: String!, $expectedVersion: Int) {
        renamePacket(id: $id, name: $name, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ renamePacket: { id: string } }>(query, { id, name, expectedVersion: expectedVersion ?? null }).pipe(
      map(d => d.renamePacket.id)
    );
  }

  setPacketDifficulty(id: string, difficultyId: string, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $difficultyId: ID!, $expectedVersion: Int) {
        setPacketDifficulty(id: $id, difficultyId: $difficultyId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ setPacketDifficulty: { id: string } }>(query, {
      id,
      difficultyId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.setPacketDifficulty.id));
  }

  /**
   * Publish/unpublish (M2's mutation; M3 adds `expectedVersion` in place,
   * plan 3.1.10). Bumps the packet's version like any other content mutation.
   */
  setPacketVisibility(id: string, visibility: PacketVisibility, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $visibility: PacketVisibility!, $expectedVersion: Int) {
        setPacketVisibility(id: $id, visibility: $visibility, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ setPacketVisibility: { id: string } }>(query, {
      id,
      visibility,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.setPacketVisibility.id));
  }

  deletePacket(id: string, expectedVersion?: number | null): Observable<boolean> {
    const query = `
      mutation ($id: ID!, $expectedVersion: Int) {
        deletePacket(id: $id, expectedVersion: $expectedVersion)
      }
    `;
    return this.post<{ deletePacket: boolean }>(query, { id, expectedVersion: expectedVersion ?? null }).pipe(
      map(d => d.deletePacket)
    );
  }

  /** Duplicates a packet the caller can fully read (owner or `packet:manage-any`), as a new owned DRAFT. */
  clonePacket(id: string, name?: string | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $name: String) {
        clonePacket(id: $id, name: $name) { id }
      }
    `;
    return this.post<{ clonePacket: { id: string } }>(query, { id, name: name ?? null }).pipe(
      map(d => d.clonePacket.id)
    );
  }

  /**
   * Parses and (optionally) commits ACF/NAQT-style plaintext (D5). With
   * `dryRun: true` (the default) it writes nothing and returns the parse
   * preview only.
   */
  importPacket(input: ImportPacketInput): Observable<ImportPacketResult> {
    const query = `
      mutation ($input: ImportPacketInput!) {
        importPacket(input: $input) {
          committed
          packet { id }
          parsed {
            suggestedName
            tossups { number line question answer categoryTag subcategory { id name category { id name } } }
            bonuses {
              number line preamble categoryTag subcategory { id name category { id name } }
              parts { line question answer }
            }
          }
          issues { severity line message }
        }
      }
    `;
    return this.post<{ importPacket: ImportPacketResult }>(query, { input }).pipe(
      map(d => d.importPacket)
    );
  }

  /* -------------------------------- tossups -------------------------------- */

  addTossupToPacket(
    packetId: string,
    input: TossupInput,
    order: number | null = null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: TossupInput!, $order: Int, $expectedVersion: Int) {
        addTossupToPacket(packetId: $packetId, input: $input, order: $order, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ addTossupToPacket: { id: string } }>(query, {
      packetId,
      input,
      order,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.addTossupToPacket.id));
  }

  updateTossup(id: string, input: TossupInput, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $input: TossupInput!, $expectedVersion: Int) {
        updateTossup(id: $id, input: $input, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ updateTossup: { id: string } }>(query, { id, input, expectedVersion: expectedVersion ?? null }).pipe(
      map(d => d.updateTossup.id)
    );
  }

  removeTossupFromPacket(packetId: string, tossupId: string, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $tossupId: ID!, $expectedVersion: Int) {
        removeTossupFromPacket(packetId: $packetId, tossupId: $tossupId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ removeTossupFromPacket: { id: string } }>(query, {
      packetId,
      tossupId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.removeTossupFromPacket.id));
  }

  reorderTossup(packetId: string, tossupId: string, newOrder: number, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $tossupId: ID!, $newOrder: Int!, $expectedVersion: Int) {
        reorderTossup(packetId: $packetId, tossupId: $tossupId, newOrder: $newOrder, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ reorderTossup: { id: string } }>(query, {
      packetId,
      tossupId,
      newOrder,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.reorderTossup.id));
  }

  /* -------------------------------- bonuses -------------------------------- */

  addBonusToPacket(
    packetId: string,
    input: BonusInput,
    order: number | null = null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: BonusInput!, $order: Int, $expectedVersion: Int) {
        addBonusToPacket(packetId: $packetId, input: $input, order: $order, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ addBonusToPacket: { id: string } }>(query, {
      packetId,
      input,
      order,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.addBonusToPacket.id));
  }

  updateBonus(id: string, input: BonusUpdateInput, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($id: ID!, $input: BonusUpdateInput!, $expectedVersion: Int) {
        updateBonus(id: $id, input: $input, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ updateBonus: { id: string } }>(query, { id, input, expectedVersion: expectedVersion ?? null }).pipe(
      map(d => d.updateBonus.id)
    );
  }

  removeBonusFromPacket(packetId: string, bonusId: string, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $bonusId: ID!, $expectedVersion: Int) {
        removeBonusFromPacket(packetId: $packetId, bonusId: $bonusId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ removeBonusFromPacket: { id: string } }>(query, {
      packetId,
      bonusId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.removeBonusFromPacket.id));
  }

  reorderBonus(packetId: string, bonusId: string, newOrder: number, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $bonusId: ID!, $newOrder: Int!, $expectedVersion: Int) {
        reorderBonus(packetId: $packetId, bonusId: $bonusId, newOrder: $newOrder, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ reorderBonus: { id: string } }>(query, {
      packetId,
      bonusId,
      newOrder,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.reorderBonus.id));
  }

  /* ------------------------------ bonus parts ------------------------------ */

  addBonusPart(
    bonusId: string,
    input: BonusPartInput,
    order: number | null = null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $input: BonusPartInput!, $order: Int, $expectedVersion: Int) {
        addBonusPart(bonusId: $bonusId, input: $input, order: $order, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ addBonusPart: { id: string } }>(query, {
      bonusId,
      input,
      order,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.addBonusPart.id));
  }

  updateBonusPart(
    bonusId: string,
    bonusPartId: string,
    input: BonusPartInput,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!, $input: BonusPartInput!, $expectedVersion: Int) {
        updateBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId, input: $input, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ updateBonusPart: { id: string } }>(query, {
      bonusId,
      bonusPartId,
      input,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.updateBonusPart.id));
  }

  removeBonusPart(bonusId: string, bonusPartId: string, expectedVersion?: number | null): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!, $expectedVersion: Int) {
        removeBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ removeBonusPart: { id: string } }>(query, {
      bonusId,
      bonusPartId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.removeBonusPart.id));
  }

  reorderBonusPart(
    bonusId: string,
    bonusPartId: string,
    newOrder: number,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!, $newOrder: Int!, $expectedVersion: Int) {
        reorderBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId, newOrder: $newOrder, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ reorderBonusPart: { id: string } }>(query, {
      bonusId,
      bonusPartId,
      newOrder,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.reorderBonusPart.id));
  }

  /* -------------------------- taxonomy create/assign ------------------------ */

  createDifficulty(name: string): Observable<Difficulty> {
    const query = `
      mutation ($name: String!) {
        createDifficulty(name: $name) { id name }
      }
    `;
    return this.post<{ createDifficulty: Difficulty }>(query, { name }).pipe(
      map(d => d.createDifficulty)
    );
  }

  createCategory(name: string): Observable<Category> {
    const query = `
      mutation ($name: String!) {
        createCategory(name: $name) { id name }
      }
    `;
    return this.post<{ createCategory: Category }>(query, { name }).pipe(
      map(d => d.createCategory)
    );
  }

  createSubcategory(name: string, categoryId: string): Observable<Subcategory> {
    const query = `
      mutation ($name: String!, $categoryId: ID!) {
        createSubcategory(name: $name, categoryId: $categoryId) { id name category { id name } }
      }
    `;
    return this.post<{ createSubcategory: Subcategory }>(query, { name, categoryId }).pipe(
      map(d => d.createSubcategory)
    );
  }

  /** A `null` `subcategoryId` clears the tossup's subcategory (PB-09). */
  setTossupSubcategory(
    tossupId: string,
    subcategoryId: string | null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($tossupId: ID!, $subcategoryId: ID, $expectedVersion: Int) {
        setTossupSubcategory(tossupId: $tossupId, subcategoryId: $subcategoryId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ setTossupSubcategory: { id: string } }>(query, {
      tossupId,
      subcategoryId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.setTossupSubcategory.id));
  }

  /** A `null` `subcategoryId` clears the bonus's subcategory (PB-09). */
  setBonusSubcategory(
    bonusId: string,
    subcategoryId: string | null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $subcategoryId: ID, $expectedVersion: Int) {
        setBonusSubcategory(bonusId: $bonusId, subcategoryId: $subcategoryId, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ setBonusSubcategory: { id: string } }>(query, {
      bonusId,
      subcategoryId,
      expectedVersion: expectedVersion ?? null
    }).pipe(map(d => d.setBonusSubcategory.id));
  }

  /* ----------------------------- taxonomy admin ----------------------------- */
  // Rename/merge require `taxonomy:manage` server-side (moderator/admin, D4).
  // No delete: an unwanted node is merged into another, never removed outright.

  renameCategory(id: string, name: string): Observable<Category> {
    const query = `
      mutation ($id: ID!, $name: String!) {
        renameCategory(id: $id, name: $name) { id name }
      }
    `;
    return this.post<{ renameCategory: Category }>(query, { id, name }).pipe(map(d => d.renameCategory));
  }

  renameSubcategory(id: string, name: string): Observable<Subcategory> {
    const query = `
      mutation ($id: ID!, $name: String!) {
        renameSubcategory(id: $id, name: $name) { id name category { id name } }
      }
    `;
    return this.post<{ renameSubcategory: Subcategory }>(query, { id, name }).pipe(map(d => d.renameSubcategory));
  }

  renameDifficulty(id: string, name: string): Observable<Difficulty> {
    const query = `
      mutation ($id: ID!, $name: String!) {
        renameDifficulty(id: $id, name: $name) { id name }
      }
    `;
    return this.post<{ renameDifficulty: Difficulty }>(query, { id, name }).pipe(map(d => d.renameDifficulty));
  }

  mergeCategories(sourceId: string, targetId: string): Observable<Category> {
    const query = `
      mutation ($sourceId: ID!, $targetId: ID!) {
        mergeCategories(sourceId: $sourceId, targetId: $targetId) { id name }
      }
    `;
    return this.post<{ mergeCategories: Category }>(query, { sourceId, targetId }).pipe(map(d => d.mergeCategories));
  }

  mergeSubcategories(sourceId: string, targetId: string): Observable<Subcategory> {
    const query = `
      mutation ($sourceId: ID!, $targetId: ID!) {
        mergeSubcategories(sourceId: $sourceId, targetId: $targetId) { id name category { id name } }
      }
    `;
    return this.post<{ mergeSubcategories: Subcategory }>(query, { sourceId, targetId }).pipe(
      map(d => d.mergeSubcategories)
    );
  }

  mergeDifficulties(sourceId: string, targetId: string): Observable<Difficulty> {
    const query = `
      mutation ($sourceId: ID!, $targetId: ID!) {
        mergeDifficulties(sourceId: $sourceId, targetId: $targetId) { id name }
      }
    `;
    return this.post<{ mergeDifficulties: Difficulty }>(query, { sourceId, targetId }).pipe(
      map(d => d.mergeDifficulties)
    );
  }

  /* --------------------------------- AI assist ------------------------------ */

  /**
   * Timeout matches SockbowlQuestionsService.generatePacket's 11-minute
   * (660000ms) budget for AI generation, since this hits the same
   * generation pipeline for a single tossup.
   */
  generateAndAddTossup(
    packetId: string,
    input: GenerateTossupInput,
    order: number | null = null,
    expectedVersion?: number | null
  ): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: GenerateTossupInput!, $order: Int, $expectedVersion: Int) {
        generateAndAddTossup(packetId: $packetId, input: $input, order: $order, expectedVersion: $expectedVersion) { id }
      }
    `;
    return this.post<{ generateAndAddTossup: { id: string } }>(
      query,
      { packetId, input, order, expectedVersion: expectedVersion ?? null },
      660000
    ).pipe(map(d => d.generateAndAddTossup.id));
  }
}
