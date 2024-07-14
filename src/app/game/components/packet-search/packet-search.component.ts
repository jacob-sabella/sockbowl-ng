import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { SockbowlQuestionsService } from '../../services/sockbowl-questions.service';
import { Packet } from '../../models/sockbowl/sockbowl-interfaces';

@Component({
  selector: 'app-packet-search',
  templateUrl: './packet-search.component.html',
  styleUrls: ['./packet-search.component.scss']
})
export class PacketSearchComponent implements OnInit {
  searchQuery: string = "";
  searchResults: Packet[] = [];
  selectedPacketId: String = "";

  constructor(
    private dialogRef: MatDialogRef<PacketSearchComponent>,
    private sockbowlQuestionsService: SockbowlQuestionsService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {}

  searchPackets(): void {
    if (this.searchQuery) {
      this.sockbowlQuestionsService.searchPacketsByName(this.searchQuery).subscribe(results => {
        this.searchResults = results;
      });
    } else {
      this.searchResults = [];
    }
  }

  selectPacket(packet: Packet): void {
    this.selectedPacketId = packet.id;
    this.dialogRef.close(packet);
  }

  close(): void {
    this.dialogRef.close();
  }
}
