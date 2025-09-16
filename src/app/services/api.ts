import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ApiService {
  base = 'http://localhost:5000';
  constructor(private http: HttpClient) { }

  startSession(payload: any) { return this.http.post(`${this.base}/start-session`, payload).toPromise(); }
  logEvent(payload: any) { return this.http.post(`${this.base}/log`, payload).toPromise(); }
  uploadVideo(fd: FormData) { return this.http.post(`${this.base}/upload-video`, fd).toPromise(); }
  getReport(sessionId: string) { return this.http.get(`${this.base}/report/${sessionId}`, { responseType: 'blob' }).toPromise(); }
}
