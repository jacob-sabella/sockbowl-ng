import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Packet } from '../models/sockbowl/sockbowl-interfaces';
import {environment} from "../../../environments/environment";
import {map, timeout} from "rxjs/operators";

@Injectable({
  providedIn: 'root'
})
export class SockbowlQuestionsService {

  private graphqlUrl: string = environment.sockbowlQuestionsApiUrl + "graphql";

  constructor(private http: HttpClient) { }

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

    return this.http.post<{ data: { getPacketById: any | null } }>(this.graphqlUrl, {
      query,
      variables: { id }
    }).pipe(
      map(response => {
        const packet = response.data.getPacketById;
        if (!packet) return null;

        // Transform nested GraphQL relationship structure to flat Angular model structure
        return {
          ...packet,
          bonuses: packet.bonuses?.map((containsBonus: any) => ({
            order: containsBonus.order,
            bonus: {
              ...containsBonus.bonus,
              bonusParts: containsBonus.bonus.bonusParts
                ?.map((hasBonusPart: any) => hasBonusPart.bonusPart)
                .sort((a: any, b: any) => {
                  // Sort by the order field if available
                  const orderA = containsBonus.bonus.bonusParts.find((hp: any) => hp.bonusPart.id === a.id)?.order || 0;
                  const orderB = containsBonus.bonus.bonusParts.find((hp: any) => hp.bonusPart.id === b.id)?.order || 0;
                  return orderA - orderB;
                })
            }
          })) || [],
          tossups: packet.tossups?.map((containsTossup: any) => ({
            order: containsTossup.order,
            tossup: containsTossup.tossup
          })) || []
        };
      })
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
    return this.http.get<any>(url, { params, headers }).pipe(
      timeout(660000),
      map(packet => {
        // Transform nested REST API relationship structure to flat Angular model structure
        // (same transformation as GraphQL response)
        return {
          ...packet,
          bonuses: packet.bonuses?.map((containsBonus: any) => ({
            order: containsBonus.order,
            bonus: {
              ...containsBonus.bonus,
              bonusParts: containsBonus.bonus.bonusParts
                ?.map((hasBonusPart: any) => hasBonusPart.bonusPart)
                .sort((a: any, b: any) => {
                  // Sort by the order field if available
                  const orderA = containsBonus.bonus.bonusParts.find((hp: any) => hp.bonusPart.id === a.id)?.order || 0;
                  const orderB = containsBonus.bonus.bonusParts.find((hp: any) => hp.bonusPart.id === b.id)?.order || 0;
                  return orderA - orderB;
                })
            }
          })) || [],
          tossups: packet.tossups?.map((containsTossup: any) => ({
            order: containsTossup.order,
            tossup: containsTossup.tossup
          })) || []
        };
      })
    );
  }
}
