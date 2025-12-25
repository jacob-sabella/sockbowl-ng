import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

    return this.http.post<{ data: { getPacketById: Packet | null } }>(this.graphqlUrl, {
      query,
      variables: { id }
    }).pipe(
      map(response => response.data.getPacketById)
    );
  }

  /**
   * Generate a packet using AI.
   *
   * @param topic Main topic for the packet
   * @param additionalContext Additional context or constraints
   * @return Observable of generated Packet
   */
  generatePacket(topic: string, additionalContext: string = ''): Observable<Packet> {
    const url = `${environment.sockbowlQuestionsApiUrl}api/packets/generate`;
    const params: any = { topic };
    if (additionalContext) {
      params.additionalContext = additionalContext;
    }

    // Set timeout to 5 minutes (300000ms) for AI generation with bonuses
    return this.http.get<Packet>(url, { params }).pipe(
      timeout(300000)
    );
  }
}
