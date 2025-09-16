import { Injectable } from '@angular/core';
import { ApiService } from './api';
import { SocketService } from './socket';

@Injectable({ providedIn: 'root' })
export class DetectionService {
  modelObj: any = null;
  faceMeshInstance: any = null;
  camera: any = null;
  sessionId = '';
  role = '';
  name = '';

  noFaceCountMs = 0;
  lookingAwayCountMs = 0;

  recentObjectDetections: Record<string, number> = {};

  constructor(private api: ApiService, private socket: SocketService) { }

  async init(sessionId: string, role: string, name: string, videoEl: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
    this.sessionId = sessionId; this.role = role; this.name = name;
    // load TFJS model
    if (!(window as any).cocoSsd) {
      console.error('cocoSsd not found on window. Ensure TFJS script loaded.');
    }
    this.modelObj = await (window as any).cocoSsd.load();

    // MediaPipe face mesh
    this.faceMeshInstance = new (window as any).FaceMesh({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });

    this.faceMeshInstance.setOptions({
      maxNumFaces: 2,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.faceMeshInstance.onResults((results: any) => {
      this.onFaceResults(results, overlayCanvas);
    });

    this.camera = new (window as any).Camera(videoEl, {
      onFrame: async () => { await this.faceMeshInstance.send({ image: videoEl }); },
      width: 640, height: 480
    });
    this.camera.start();

    // periodic object detection
    setInterval(()=>this.runObjectDetection(videoEl, overlayCanvas), 700);
  }

  onFaceResults(results: any, overlayCanvas: HTMLCanvasElement) {
    const ctx = overlayCanvas.getContext('2d')!;
    overlayCanvas.width = results.image?.width ?? 640;
    overlayCanvas.height = results.image?.height ?? 480;
    ctx.clearRect(0,0,overlayCanvas.width, overlayCanvas.height);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.noFaceCountMs += 100;
      if (this.noFaceCountMs >= 10000) {
        this.logEvent('no_face', { message:'No face >10s' });
        this.noFaceCountMs = 0;
      }
      return;
    }

    // multiple faces?
    if (results.multiFaceLandmarks.length > 1) {
      this.logEvent('multiple_faces', { count: results.multiFaceLandmarks.length });
    }

    this.noFaceCountMs = 0;
    const landmarks = results.multiFaceLandmarks[0];
    // draw subset
    ctx.fillStyle = 'rgba(0,255,0,0.7)';
    for (let i=0;i<landmarks.length;i+=6){
      const x = landmarks[i].x * overlayCanvas.width;
      const y = landmarks[i].y * overlayCanvas.height;
      ctx.beginPath(); ctx.arc(x,y,1.6,0,Math.PI*2); ctx.fill();
    }

    const leftEye = landmarks[33], rightEye = landmarks[263], nose = landmarks[1];
    const eyeCenterX = (leftEye.x + rightEye.x)/2;
    const diff = Math.abs(nose.x - eyeCenterX);

    if (diff > 0.07) {
      this.lookingAwayCountMs += 100;
      if (this.lookingAwayCountMs >= 5000) {
        this.logEvent('looking_away', { message:'User looking away >5s', diff });
        this.lookingAwayCountMs = 0;
      }
    } else {
      this.lookingAwayCountMs = 0;
    }
  }

  async runObjectDetection(videoEl: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
    if (!this.modelObj) return;
    try {
      const predictions = await this.modelObj.detect(videoEl);
      const relevant = predictions.filter((p:any)=>['cell phone','book','laptop','remote'].includes(p.class) && p.score>0.5);
      for (const p of relevant) {
        // simple deduplication: only log if not logged in last 5 seconds
        const key = `${p.class}`;
        const now = Date.now();
        if (!this.recentObjectDetections[key] || (now - this.recentObjectDetections[key] > 5000)) {
          this.recentObjectDetections[key] = now;
          this.logEvent('object_detected', { class: p.class, score: p.score, bbox: p.bbox });
        }
      }
    } catch(e) {
      console.warn('object detect error', e);
    }
  }

  async logEvent(type: string, detail: any) {
    const payload = {
      sessionId: this.sessionId, role: this.role, name: this.name,
      timestamp: new Date().toISOString(), type, detail
    };
    try {
      await this.api.logEvent(payload);
    } catch(e){ console.warn('log failed', e); }
    this.socket.emit('event', payload);
  }
}
