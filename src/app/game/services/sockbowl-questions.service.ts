import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Packet } from '../models/sockbowl/packet-types.generated';
import {environment} from "../../../environments/environment";
import {map, timeout} from "rxjs/operators";

@Injectable({
  providedIn: 'root'
})
export class SockbowlQuestionsService {

  private graphqlUrl: string = environment.sockbowlQuestionsApiUrl + "graphql";
  private qbreaderUrl: string = environment.sockbowlQuestionsApiUrl + "api/qbreader";
  // Per-user used-question tracking lives on the game backend (Postgres + auth).
  // sockbowlGameApiUrl is session-scoped (…/api/v1/session), so swap the tail for the user API.
  private gameUserUrl: string =
    environment.sockbowlGameApiUrl.replace(/api\/v1\/session\/?$/, "api/v1/user");

  constructor(private http: HttpClient) { }

  /** All qbreader.org set names (e.g. "2021 SMH"). */
  getQbreaderSets(): Observable<string[]> {
    return this.http.get<string[]>(`${this.qbreaderUrl}/sets`).pipe(timeout(20000));
  }

  /** Number of packets in a qbreader set. */
  getQbreaderPacketCount(setName: string): Observable<number> {
    return this.http
      .get<{ numPackets: number }>(`${this.qbreaderUrl}/packet-count`, { params: { setName } })
      .pipe(timeout(20000), map(r => r.numPackets));
  }

  /** Import one published packet from a qbreader set; resolves to the new packet id/name. */
  importQbreaderPacket(setName: string, packetNumber: number): Observable<{ id: string; name: string }> {
    return this.http
      .post<{ id: string; name: string }>(`${this.qbreaderUrl}/import`, { setName, packetNumber })
      .pipe(timeout(120000));
  }

  /** Build a random qbreader packet from the full qbreader filter set (all fields optional). */
  importQbreaderRandom(body: {
    categories?: string[]; subcategories?: string[]; alternateSubcategories?: string[]; difficulties?: number[];
    minYear?: number; maxYear?: number; standardOnly?: boolean;
    tossupCount: number; bonusCount: number; name?: string; excludeRemoteIds?: string[];
  }): Observable<{ id: string; name: string; usedRemoteIds: string[] }> {
    return this.http
      .post<{ id: string; name: string; usedRemoteIds: string[] }>(`${this.qbreaderUrl}/import-random`, body)
      .pipe(timeout(120000));
  }

  /** The qbreader question ids the logged-in user has already been served (auth required). */
  getUsedQuestionIds(): Observable<string[]> {
    return this.http.get<string[]>(`${this.gameUserUrl}/used-questions`).pipe(timeout(20000));
  }

  /** Record qbreader question ids just served to the logged-in user (auth required). */
  recordUsedQuestionIds(remoteIds: string[]): Observable<{ recorded: number }> {
    return this.http
      .post<{ recorded: number }>(`${this.gameUserUrl}/used-questions`, remoteIds)
      .pipe(timeout(20000));
  }

  /**
   * Query to search packets by name.
   *
   * @param name Name of the packet to search
   * @return Observable of Packet array
   */
  searchPacketsByName(name: string): Observable<Packet[]> {
    const query = `
      query ($name: String!) {
        searchPacketsByName(name: $name) {
          id
          name
          bonuses {
            id
          }
        }
      }
    `;

    return this.http.post<{ data: { searchPacketsByName: Packet[] } }>(this.graphqlUrl, {
      query,
      variables: { name }
    }).pipe(
      // Transform the response to only return the packets array
      map(response => response.data.searchPacketsByName)
    );
  }

  /**
   * Get a packet by ID with full details including bonuses.
   *
   * @param id Packet ID
   * @return Observable of Packet
   */
  getPacketById(id: string): Observable<Packet | null> {
    const query = `
      query ($id: ID!) {
        getPacketById(id: $id) {
          id
          name
          bonuses {
            order
            bonus {
              id
              preamble
              bonusParts {
                order
                bonusPart {
                  id
                  question
                  answer
                }
              }
            }
          }
          tossups {
            order
            tossup {
              id
              question
              answer
            }
          }
        }
      }
    `;

    return this.http.post<{ data: { getPacketById: Packet | null } }>(this.graphqlUrl, {
      query,
      variables: { id }
    }).pipe(
      map(response => sortPacketRelationships(response.data.getPacketById))
    );
  }

  /**
   * Generate a packet using AI.
   *
   * @param topic Main topic for the packet
   * @param additionalContext Additional context or constraints
   * @param apiKey User-provided OpenAI API key
   * @param model User-provided OpenAI model
   * @param questionCount Number of tossups/bonuses to generate (1-30, default 5)
   * @param generateBonuses Whether to generate bonuses (default true)
   * @param temperature Controls randomness (0.0-2.0, default 1.0)
   * @param topP Controls diversity via nucleus sampling (0.0-1.0, default 1.0)
   * @param frequencyPenalty Penalizes token frequency (-2.0 to 2.0, default 0.0)
   * @param presencePenalty Penalizes token presence (-2.0 to 2.0, default 0.0)
   * @return Observable of generated Packet
   */
  generatePacket(
    topic: string,
    additionalContext: string = '',
    apiKey: string,
    model: string,
    questionCount: number = 5,
    generateBonuses: boolean = true,
    temperature?: number,
    topP?: number,
    frequencyPenalty?: number,
    presencePenalty?: number
  ): Observable<Packet> {
    const url = `${environment.sockbowlQuestionsApiUrl}api/packets/generate`;
    const params: any = { topic };
    if (additionalContext) {
      params.additionalContext = additionalContext;
    }
    if (questionCount !== undefined && questionCount !== null) {
      params.questionCount = questionCount;
    }
    if (generateBonuses !== undefined && generateBonuses !== null) {
      params.generateBonuses = generateBonuses;
    }

    // Build headers with API key, model, and optional LLM parameters
    let headers = new HttpHeaders({
      'X-API-Key': apiKey,
      'X-Model': model
    });

    // Add optional LLM parameters if provided
    if (temperature !== undefined) {
      headers = headers.set('X-Temperature', temperature.toString());
    }
    if (topP !== undefined) {
      headers = headers.set('X-Top-P', topP.toString());
    }
    if (frequencyPenalty !== undefined) {
      headers = headers.set('X-Frequency-Penalty', frequencyPenalty.toString());
    }
    if (presencePenalty !== undefined) {
      headers = headers.set('X-Presence-Penalty', presencePenalty.toString());
    }

    // Set timeout to 11 minutes (660000ms) for AI generation with bonuses
    // Server-side timeout is 10 minutes, so we give it extra buffer
    return this.http.get<Packet>(url, { params, headers }).pipe(
      timeout(660000),
      // Returns the packet in the canonical GraphQL relationship shape
      // (tossups: ContainsTossup[], bonuses: ContainsBonus[] with nested
      // HasBonusPart wrappers), matching the generated packet types.
      map(packet => sortPacketRelationships(packet) as Packet)
    );
  }
}

/**
 * Sorts a packet's nested bonus parts by their relationship order, in place,
 * preserving the canonical GraphQL relationship wrappers. Returns the packet
 * unchanged (or null) so it can be dropped straight into an rxjs map.
 */
function sortPacketRelationships(packet: Packet | null): Packet | null {
  if (!packet) {
    return null;
  }
  packet.bonuses?.forEach(containsBonus => {
    containsBonus?.bonus?.bonusParts?.sort(
      (a, b) => (a?.order ?? 0) - (b?.order ?? 0)
    );
  });
  return packet;
}
