import { Injectable } from '@angular/core';
@Injectable({ providedIn: 'root' })
export class VideoService {
  mediaStream: MediaStream|null = null;
  mediaRecorder: MediaRecorder|null = null;
  chunks: Blob[] = [];

  async startCamera(videoEl: HTMLVideoElement) {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: 640, height: 480 } });
    videoEl.srcObject = this.mediaStream;
    await videoEl.play();
  }

  startRecording() {
    if (!this.mediaStream) return;
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType: 'video/webm; codecs=vp9' });
    this.mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
  }

  stopRecording(): Blob|null {
    return new Promise<Blob|null>((resolve) => {
      if (!this.mediaRecorder) return resolve(null);
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'video/webm' });
        resolve(blob);
      };
      this.mediaRecorder.stop();
    }) as unknown as Blob|null;
  }
}
