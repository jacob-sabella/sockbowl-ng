import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { Packet } from '../../models/sockbowl/sockbowl-interfaces';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

@Component({
    selector: 'app-packet-search',
    templateUrl: './packet-search.component.html',
    styleUrls: ['./packet-search.component.scss'],
    standalone: false
})
export class PacketSearchComponent implements OnInit {
  // Search tab properties
  searchQuery: string = "";
  searchResults: Packet[] = [];
  selectedPacketId: String = "";
  isSearching: boolean = false;
  private searchSubject = new Subject<string>();

  // Generate tab properties
  generateTopic: string = "";
  generateContext: string = "";
  isGenerating: boolean = false;
  generatedPacket: Packet | null = null;

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

  generateAIPacket(): void {
    if (!this.generateTopic) {
      return;
    }

    this.isGenerating = true;
    this.sockbowlQuestionsService.generatePacket(this.generateTopic, this.generateContext).subscribe({
      next: (packet) => {
        this.generatedPacket = packet;
        this.isGenerating = false;
      },
      error: (error) => {
        console.error('Generation error:', error);
        this.isGenerating = false;
        // TODO: Show error message to user
      }
    });
  }

  confirmSelection(): void {
    // Prioritize generated packet if it exists
    if (this.generatedPacket) {
      this.dialogRef.close(this.generatedPacket);
      return;
    }

    // Otherwise use selected packet from search
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
