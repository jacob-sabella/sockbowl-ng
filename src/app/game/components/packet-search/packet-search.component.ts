import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { Packet } from '../../models/sockbowl/sockbowl-interfaces';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-packet-search',
  templateUrl: './packet-search.component.html',
  styleUrls: ['./packet-search.component.scss']
})
export class PacketSearchComponent implements OnInit {
  searchQuery: string = "";
  searchResults: Packet[] = [];
  selectedPacketId: String = "";
  isSearching: boolean = false;
  private searchSubject = new Subject<string>();

  constructor(
    private dialogRef: MatDialogRef<PacketSearchComponent>,
    private sockbowlQuestionsService: SockbowlQuestionsService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    // Set up debounced search
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(query => {
      this.performSearch(query);
    });
  }

  searchPackets(): void {
    this.searchSubject.next(this.searchQuery);
  }

  private performSearch(query: string): void {
    if (query && query.length >= 2) {
      this.isSearching = true;
      this.sockbowlQuestionsService.searchPacketsByName(query).subscribe({
        next: (results) => {
          this.searchResults = results;
          this.isSearching = false;
        },
        error: (error) => {
          console.error('Search error:', error);
          this.searchResults = [];
          this.isSearching = false;
        }
      });
    } else {
      this.searchResults = [];
      this.isSearching = false;
    }
  }

  selectPacket(packet: Packet): void {
    this.selectedPacketId = packet.id;
  }

  confirmSelection(): void {
    const selectedPacket = this.searchResults.find(p => p.id === this.selectedPacketId);
    if (selectedPacket) {
      this.dialogRef.close(selectedPacket);
    }
  }

  clearSearch(): void {
    this.searchQuery = "";
    this.searchResults = [];
    this.selectedPacketId = "";
  }

  close(): void {
    this.dialogRef.close();
  }
}
