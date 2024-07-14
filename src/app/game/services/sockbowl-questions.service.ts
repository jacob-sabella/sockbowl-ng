import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from "../../../environments/environment";
import {Packet} from "../models/sockbowl/sockbowl-interfaces";

@Injectable({
  providedIn: 'root'
})
export class SockbowlQuestionsService {

  private baseUrl: string = environment.sockbowlQuestionsApiUrl;

  constructor(private http: HttpClient) { }

  // Method to get a packet by ID
  getPacketById(id: string): Observable<Packet> {
    const url = `${this.baseUrl}/get/${id}`;
    return this.http.get<Packet>(url);
  }

  // Method to search packets by name
  searchPacketsByName(name: string): Observable<Packet[]> {
    const url = `${this.baseUrl}/search?name=${name}`;
    return this.http.get<Packet[]>(url);
  }
}
