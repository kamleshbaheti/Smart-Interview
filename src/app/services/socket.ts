import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SocketService {
  private socket: Socket;
  constructor() {
    this.socket = io('http://localhost:5000', { transports: ['websocket', 'polling'] });
  }

   // getters
  getId(): string | undefined {
    return this.socket?.id;
  }

  joinRoom(sessionId: string, role: string, name: string) {
    this.socket.emit('join', { sessionId, role, name });
  }

  onEvent(eventName: string): Observable<any> {
    return new Observable(observer => {
      this.socket.on(eventName, (data: any) => observer.next(data));
    });
  }

  emit(eventName: string, data: any) {
    this.socket.emit(eventName, data);
  }

  join(sessionId: string, name: string) {
    this.socket.emit('join', { sessionId, name });
  }

  sendMessage(msg: any): void {
    this.socket.emit('message', msg);
  }

  onMessage(callback: (msg: any) => void): void {
    this.socket.on('message', (msg: any) => {
      callback(msg);
    });
  }

  // generic on -> returns observable
  on(eventName: string): Observable<any> {
    return new Observable(observer => {
      const handler = (data: any) => observer.next(data);
      this.socket.on(eventName, handler);
      return () => this.socket.off(eventName, handler);
    });
  }
}
