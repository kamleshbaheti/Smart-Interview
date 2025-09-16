import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-join',
  imports: [CommonModule, FormsModule],
  templateUrl: './join.html',
  styleUrl: './join.css'
})
export class Join {
  sessionId = '';
  name = '';

  constructor(private router: Router, private api: ApiService) {}

  async join() {
    if (!this.sessionId || !this.name) return alert('Enter both name and session id');
    // optional: verify session exists (call startSession to create if not exist)
    await this.api.startSession({ sessionId: this.sessionId, name: this.name }).catch(()=>{});
    this.router.navigate(['/room', this.sessionId, 'interviewee', this.name]);
  }
}
