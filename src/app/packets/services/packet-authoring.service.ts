import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import {
  BonusInput,
  BonusPartInput,
  BonusUpdateInput,
  Category,
  Difficulty,
  GenerateTossupInput,
  Subcategory,
  TossupInput,
  CreatePacketInput
} from '../models/packet-authoring.models';

/**
 * All 22 packet authoring mutations plus the 3 taxonomy list queries, over
 * the same GraphQL endpoint used by SockbowlQuestionsService. Each mutation
 * only requests `{ id }` back (or a bare boolean for deletePacket) since the
 * calling component always refetches the full packet via
 * SockbowlQuestionsService.getPacketById() right after a successful call.
 */
@Injectable({
  providedIn: 'root'
})
export class PacketAuthoringService {

  private graphqlUrl: string = environment.sockbowlQuestionsApiUrl + 'graphql';

  constructor(private http: HttpClient) {}

  private post<T>(query: string, variables: any): Observable<T> {
    return this.http.post<{ data: T }>(this.graphqlUrl, { query, variables }).pipe(
      timeout(15000),
      map(response => response.data)
    );
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

  renamePacket(id: string, name: string): Observable<string> {
    const query = `
      mutation ($id: ID!, $name: String!) {
        renamePacket(id: $id, name: $name) { id }
      }
    `;
    return this.post<{ renamePacket: { id: string } }>(query, { id, name }).pipe(
      map(d => d.renamePacket.id)
    );
  }

  setPacketDifficulty(id: string, difficultyId: string): Observable<string> {
    const query = `
      mutation ($id: ID!, $difficultyId: ID!) {
        setPacketDifficulty(id: $id, difficultyId: $difficultyId) { id }
      }
    `;
    return this.post<{ setPacketDifficulty: { id: string } }>(query, { id, difficultyId }).pipe(
      map(d => d.setPacketDifficulty.id)
    );
  }

  deletePacket(id: string): Observable<boolean> {
    const query = `
      mutation ($id: ID!) {
        deletePacket(id: $id)
      }
    `;
    return this.post<{ deletePacket: boolean }>(query, { id }).pipe(
      map(d => d.deletePacket)
    );
  }

  /* -------------------------------- tossups -------------------------------- */

  addTossupToPacket(packetId: string, input: TossupInput, order: number | null = null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: TossupInput!, $order: Int) {
        addTossupToPacket(packetId: $packetId, input: $input, order: $order) { id }
      }
    `;
    return this.post<{ addTossupToPacket: { id: string } }>(query, { packetId, input, order }).pipe(
      map(d => d.addTossupToPacket.id)
    );
  }

  updateTossup(id: string, input: TossupInput): Observable<string> {
    const query = `
      mutation ($id: ID!, $input: TossupInput!) {
        updateTossup(id: $id, input: $input) { id }
      }
    `;
    return this.post<{ updateTossup: { id: string } }>(query, { id, input }).pipe(
      map(d => d.updateTossup.id)
    );
  }

  removeTossupFromPacket(packetId: string, tossupId: string): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $tossupId: ID!) {
        removeTossupFromPacket(packetId: $packetId, tossupId: $tossupId) { id }
      }
    `;
    return this.post<{ removeTossupFromPacket: { id: string } }>(query, { packetId, tossupId }).pipe(
      map(d => d.removeTossupFromPacket.id)
    );
  }

  reorderTossup(packetId: string, tossupId: string, newOrder: number): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $tossupId: ID!, $newOrder: Int!) {
        reorderTossup(packetId: $packetId, tossupId: $tossupId, newOrder: $newOrder) { id }
      }
    `;
    return this.post<{ reorderTossup: { id: string } }>(query, { packetId, tossupId, newOrder }).pipe(
      map(d => d.reorderTossup.id)
    );
  }

  /* -------------------------------- bonuses -------------------------------- */

  addBonusToPacket(packetId: string, input: BonusInput, order: number | null = null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: BonusInput!, $order: Int) {
        addBonusToPacket(packetId: $packetId, input: $input, order: $order) { id }
      }
    `;
    return this.post<{ addBonusToPacket: { id: string } }>(query, { packetId, input, order }).pipe(
      map(d => d.addBonusToPacket.id)
    );
  }

  updateBonus(id: string, input: BonusUpdateInput): Observable<string> {
    const query = `
      mutation ($id: ID!, $input: BonusUpdateInput!) {
        updateBonus(id: $id, input: $input) { id }
      }
    `;
    return this.post<{ updateBonus: { id: string } }>(query, { id, input }).pipe(
      map(d => d.updateBonus.id)
    );
  }

  removeBonusFromPacket(packetId: string, bonusId: string): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $bonusId: ID!) {
        removeBonusFromPacket(packetId: $packetId, bonusId: $bonusId) { id }
      }
    `;
    return this.post<{ removeBonusFromPacket: { id: string } }>(query, { packetId, bonusId }).pipe(
      map(d => d.removeBonusFromPacket.id)
    );
  }

  reorderBonus(packetId: string, bonusId: string, newOrder: number): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $bonusId: ID!, $newOrder: Int!) {
        reorderBonus(packetId: $packetId, bonusId: $bonusId, newOrder: $newOrder) { id }
      }
    `;
    return this.post<{ reorderBonus: { id: string } }>(query, { packetId, bonusId, newOrder }).pipe(
      map(d => d.reorderBonus.id)
    );
  }

  /* ------------------------------ bonus parts ------------------------------ */

  addBonusPart(bonusId: string, input: BonusPartInput, order: number | null = null): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $input: BonusPartInput!, $order: Int) {
        addBonusPart(bonusId: $bonusId, input: $input, order: $order) { id }
      }
    `;
    return this.post<{ addBonusPart: { id: string } }>(query, { bonusId, input, order }).pipe(
      map(d => d.addBonusPart.id)
    );
  }

  updateBonusPart(bonusId: string, bonusPartId: string, input: BonusPartInput): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!, $input: BonusPartInput!) {
        updateBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId, input: $input) { id }
      }
    `;
    return this.post<{ updateBonusPart: { id: string } }>(query, { bonusId, bonusPartId, input }).pipe(
      map(d => d.updateBonusPart.id)
    );
  }

  removeBonusPart(bonusId: string, bonusPartId: string): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!) {
        removeBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId) { id }
      }
    `;
    return this.post<{ removeBonusPart: { id: string } }>(query, { bonusId, bonusPartId }).pipe(
      map(d => d.removeBonusPart.id)
    );
  }

  reorderBonusPart(bonusId: string, bonusPartId: string, newOrder: number): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $bonusPartId: ID!, $newOrder: Int!) {
        reorderBonusPart(bonusId: $bonusId, bonusPartId: $bonusPartId, newOrder: $newOrder) { id }
      }
    `;
    return this.post<{ reorderBonusPart: { id: string } }>(query, { bonusId, bonusPartId, newOrder }).pipe(
      map(d => d.reorderBonusPart.id)
    );
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

  setTossupSubcategory(tossupId: string, subcategoryId: string): Observable<string> {
    const query = `
      mutation ($tossupId: ID!, $subcategoryId: ID!) {
        setTossupSubcategory(tossupId: $tossupId, subcategoryId: $subcategoryId) { id }
      }
    `;
    return this.post<{ setTossupSubcategory: { id: string } }>(query, { tossupId, subcategoryId }).pipe(
      map(d => d.setTossupSubcategory.id)
    );
  }

  setBonusSubcategory(bonusId: string, subcategoryId: string): Observable<string> {
    const query = `
      mutation ($bonusId: ID!, $subcategoryId: ID!) {
        setBonusSubcategory(bonusId: $bonusId, subcategoryId: $subcategoryId) { id }
      }
    `;
    return this.post<{ setBonusSubcategory: { id: string } }>(query, { bonusId, subcategoryId }).pipe(
      map(d => d.setBonusSubcategory.id)
    );
  }

  /* --------------------------------- AI assist ------------------------------ */

  /**
   * Timeout matches SockbowlQuestionsService.generatePacket's 11-minute
   * (660000ms) budget for AI generation, since this hits the same
   * generation pipeline for a single tossup.
   */
  generateAndAddTossup(packetId: string, input: GenerateTossupInput, order: number | null = null): Observable<string> {
    const query = `
      mutation ($packetId: ID!, $input: GenerateTossupInput!, $order: Int) {
        generateAndAddTossup(packetId: $packetId, input: $input, order: $order) { id }
      }
    `;
    return this.http.post<{ data: { generateAndAddTossup: { id: string } } }>(this.graphqlUrl, {
      query,
      variables: { packetId, input, order }
    }).pipe(
      timeout(660000),
      map(response => response.data.generateAndAddTossup.id)
    );
  }
}
