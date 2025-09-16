import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-report',
  imports: [CommonModule],
  templateUrl: './report.html',
  styleUrl: './report.css'
})
export class Report {
  sessionId = '';
  loading = false;
  constructor(private route: ActivatedRoute, private api: ApiService) {
    this.sessionId = this.route.snapshot.paramMap.get('sessionId') || '';
  }

  async downloadReport() {
    this.loading = true;
    const blob = await this.api.getReport(this.sessionId);
    const url = window.URL.createObjectURL(blob!);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.sessionId}_report.pdf`;
    a.click();
    window.URL.revokeObjectURL(url);
    this.loading = false;
  }
}
