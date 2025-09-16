import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-home',
  imports: [CommonModule],
  templateUrl: './home.html',
  styleUrl: './home.css',
  standalone: true,
})
export class Home {
sessionId = '';
  createdSessions: string[] = [];

  constructor(private router: Router, private api: ApiService) {}

  async createSession() {
    // generate a session id and persist on backend
    const sid = 'sess-' + Math.random().toString(36).slice(2, 9);
    await this.api.startSession({ sessionId: sid, name: 'Interviewer' }).catch(()=>{});
    this.createdSessions.unshift(sid);
    this.sessionId = sid;
  }

  openRoom(sid: string) {
    // interviewer joins as role 'interviewer'
    this.router.navigate(['/room', sid, 'interviewer', 'Interviewer']);
  }

  openJoin() {
    this.router.navigate(['/join']);
  }
}
