import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Packet } from '../models/sockbowl/sockbowl-interfaces';
import {environment} from "../../../environments/environment";
import {map} from "rxjs/operators";

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
}
