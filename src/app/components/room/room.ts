// src/app/components/room/room.ts
import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectorRef
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as faceDetection from '@tensorflow-models/face-detection';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs-core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { SocketService } from '../../services/socket';

interface ChatMessage { name: string; message: string; timestamp: string; self?: boolean; sessionId?: string; }

@Component({
  selector: 'app-room',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './room.html',
  styleUrls: ['./room.css']
})
export class Room implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('videoElement', { static: false }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('snapshotImage', { static: false }) snapshotImage!: ElementRef<HTMLImageElement>;
  @ViewChild('chatHistory', { static: false }) chatHistory!: ElementRef;

  sessionId!: string;
  name: string = 'Anonymous';
  role!: 'interviewer' | 'interviewee';
  isMuted = false;
  cameraOff = false;
  isRecording = false;
  isLoading = true;
  errorMessage: string | null = null;
  mediaRecorder: MediaRecorder | null = null;

  chatText = '';
  chatMessages: ChatMessage[] = [];

  // events for live timeline
  events: any[] = [];

  // detection models + media
  private localStream: MediaStream | null = null;
  private objectDetector: cocoSsd.ObjectDetection | null = null;
  private faceDetector: faceDetection.FaceDetector | null = null;
  private recordedBlobs: Blob[] = [];
  private snapshotInterval: any;

  // signaling / rtc
  private pc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;

  // subscriptions
  private subEvent?: Subscription;
  private subChat?: Subscription;
  private subSnapshot?: Subscription;
  private offerSub?: Subscription;
  private answerSub?: Subscription;
  private iceSub?: Subscription;
  private yourIdSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private socket: SocketService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef
  ) { }

  async ngOnInit() {
    try {
      this.sessionId = this.route.snapshot.paramMap.get('sessionId') || '';
      if (!this.sessionId) throw new Error('Missing sessionId in URL');

      this.role = (sessionStorage.getItem('role') as any)
        || (this.route.snapshot.paramMap.get('role') as any)
        || 'interviewee';
      this.name = sessionStorage.getItem('name') || this.route.snapshot.paramMap.get('name') || 'Anonymous';

      await tf.setBackend('webgl');

      // join room
      this.socket.joinRoom(this.sessionId, this.role, this.name);

      // subscribe to events (live events)
      this.subEvent = this.socket.onEvent('event').subscribe((d: any) => {
        // push events for display to interviewer
        this.events.unshift(d);
        this.cdr.detectChanges();
      });

      // chat subscription
      this.subChat = this.socket.onEvent('chat').subscribe((m: ChatMessage) => {
        this.chatMessages.push({ ...m, self: m.name === this.name });
        this.cdr.detectChanges();
      });

      // snapshot fallback (if any)
      this.subSnapshot = this.socket.onEvent('snapshot').subscribe((payload: any) => {
        if (this.role === 'interviewer' && this.snapshotImage && payload) {
          const url = payload.image || payload.dataUrl || '';
          if (this.snapshotImage.nativeElement) {
            this.snapshotImage.nativeElement.src = url;
            this.cdr.detectChanges();
          }
        }
      });

      // WebRTC signaling listeners - we'll handle offers/answers/ice below
      this.offerSub = this.socket.onEvent('webrtc-offer').subscribe(async (d: any) => {
        if (d?.from && d.from === this.socket.getId()) return;
        if (this.role === 'interviewer') await this.handleRemoteOffer(d.sdp);
      });

      this.answerSub = this.socket.onEvent('webrtc-answer').subscribe(async (d: any) => {
        if (d?.from && d.from === this.socket.getId()) return;
        if (this.role === 'interviewee') await this.handleRemoteAnswer(d.sdp);
      });

      this.iceSub = this.socket.onEvent('webrtc-ice').subscribe(async (d: any) => {
        if (d?.from && d.from === this.socket.getId()) return;
        await this.addRemoteIce(d.candidate);
      });

      // optional: get your own socket id if backend emits it
      this.yourIdSub = this.socket.onEvent('your-socket-id').subscribe((d: any) => {
        // stored if needed
        console.log('your-socket-id', d);
      });

    } catch (err: any) {
      console.error('Init error', err);
      this.errorMessage = err.message || 'Initialization failed';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  startSendingFrames() {
    this.snapshotInterval = setInterval(() => {
      if (!this.videoElement || this.videoElement.nativeElement.readyState < 3) return;
      const snapshot = this.captureSnapshot();
      this.socket.emit('frame', {
        sessionId: this.sessionId,
        name: this.name,
        role: this.role,
        frame: snapshot
      });
    }, 2000); // every 2 seconds
  }


  async ngAfterViewInit() {
    // interviewee starts their local camera and then creates the offer
    if (this.role === 'interviewee') {
      await this.setupCamera();
      await this.loadDetectionModels().catch(() => { });
      // create the RTCPeerConnection and send offer
      await this.createPeerAndSendOffer();
      // snapshot fallback & detection loop
      this.startSendingSnapshots();
      this.startSendingFrames();
    } else {
      // interviewer simply waits for remote tracks; the incoming tracks will be attached to the same videoElement
    }
  }

  ngOnDestroy() {
    try {
      if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
      if (this.snapshotInterval) clearInterval(this.snapshotInterval);
      if (this.pc) { this.pc.close(); this.pc = null; }
      if (this.remoteStream) this.remoteStream.getTracks().forEach(t => t.stop());
    } catch (e) { }
    this.subEvent?.unsubscribe();
    this.subChat?.unsubscribe();
    this.subSnapshot?.unsubscribe();
    this.offerSub?.unsubscribe();
    this.answerSub?.unsubscribe();
    this.iceSub?.unsubscribe();
    this.yourIdSub?.unsubscribe();
  }

  async endCall() {
    try {
      if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
      this.socket.emit('event', {
        sessionId: this.sessionId,
        role: this.role,
        name: this.name,
        type: 'left',
        detail: { message: `${this.name} left` },
        timestamp: new Date().toISOString()
      });
    } finally {
      this.isLoading = false;
      this.errorMessage = 'Your call has been ended. Redirecting to main screen in 5 seconds...';

      // Redirect after 5 seconds
      setTimeout(() => {
        window.location.href = '/';   // or use Angular Router if you prefer
        // this.router.navigate(['/']);   <-- if you want Angular routing
      }, 5000);
    }
  }

  toggleMute() {
    if (!this.localStream) return;
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length) {
      const enabled = audioTracks[0].enabled;
      audioTracks.forEach(t => (t.enabled = !enabled));
      this.isMuted = !enabled;
      this.logEvent(this.isMuted ? 'mic_muted' : 'mic_unmuted', {});
    }
  }

  toggleCamera() {
    if (!this.localStream) return;
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length) {
      const enabled = videoTracks[0].enabled;
      videoTracks.forEach(t => (t.enabled = !enabled));
      this.cameraOff = !enabled;
      this.logEvent(this.cameraOff ? 'camera_off' : 'camera_on', {});
    }
  }


  // ------------------- media & detection -------------------
  async setupCamera() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true });
      if (this.videoElement && this.videoElement.nativeElement) {
        this.videoElement.nativeElement.srcObject = this.localStream;
        await this.videoElement.nativeElement.play().catch(() => { });
      }
    } catch (err: any) {
      console.error('Camera error', err);
      this.errorMessage = 'Cannot access camera/microphone: ' + (err.message || err.name);
      this.logEvent('media_error', { error: String(err) });
    }
  }

  async loadDetectionModels() {
    try {
      this.objectDetector = await cocoSsd.load();
      const model = faceDetection.SupportedModels.MediaPipeFaceDetector;
      const detectorConfig: faceDetection.MediaPipeFaceDetectorMediaPipeModelConfig = { runtime: 'mediapipe' };
      this.faceDetector = await faceDetection.createDetector(model, detectorConfig);
      console.log('models loaded');
    } catch (err) {
      console.warn('model load failed', err);
    }
  }

  startSendingSnapshots() {
    this.snapshotInterval = setInterval(async () => {
      if (!this.videoElement || this.videoElement.nativeElement.readyState < 3) return;
      const snapshot = this.captureSnapshot();
      this.socket.emit('snapshot', { sessionId: this.sessionId, name: this.name, image: snapshot });
      // detection on interviewee side (the existing logic)
      if (this.objectDetector && this.faceDetector) await this.detectObjectsAndFaces(this.videoElement.nativeElement);
    }, 700);
  }

  captureSnapshot(): string {
    const video = this.videoElement.nativeElement;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }

  async detectObjectsAndFaces(video: HTMLVideoElement) {
    try {
      const objects = await (this.objectDetector as any).detect(video);
      const faces = await (this.faceDetector as any).estimateFaces(video);

      // object events
      objects.forEach((o: any) => {
        const cls = o.class || o['class'];
        if (['cell phone', 'book', 'laptop', 'keyboard', 'cellphone'].includes(cls) && o.score > 0.3) {
          // log and emit event
          const ev = { sessionId: this.sessionId, role: this.role, name: this.name, type: 'object_detected', detail: { object: cls, score: o.score }, timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})};
          this.socket.emit('event', ev);
          this.logEvent('object_detected', { object: cls, score: o.score });
          console.log('object detected', { object: cls, score: o.score });
        }
      });

      // faces events
      if (!faces || faces.length === 0) {
        const ev = { sessionId: this.sessionId, role: this.role, name: this.name, type: 'no_face', detail: {}, timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})};
        this.socket.emit('event', ev); this.logEvent('no_face', {});
      } else if (faces.length > 1) {
        const ev = { sessionId: this.sessionId, role: this.role, name: this.name, type: 'multiple_faces', detail: { count: faces.length }, timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})};
        this.socket.emit('event', ev); this.logEvent('multiple_faces', { count: faces.length });
      }

    } catch (err) {
      console.warn('detection error', err);
    }
  }

  // ------------------- WebRTC: create offer (interviewee) -------------------
  private getRtcConfig(): RTCConfiguration {
    return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  }

  private async createPeerAndSendOffer() {
    if (this.role !== 'interviewee') return;
    if (!this.localStream) { console.warn('no local stream'); return; }

    this.pc = new RTCPeerConnection(this.getRtcConfig());

    // add local tracks
    this.localStream.getTracks().forEach(track => this.pc!.addTrack(track, this.localStream!));

    // forward ICE candidates to server
    this.pc.onicecandidate = (ev) => {
      if (ev.candidate) this.socket.emit('webrtc-ice', { sessionId: this.sessionId, candidate: ev.candidate });
    };

    // optional: handle remote tracks if interviewer sends anything (not used)
    this.pc.ontrack = (ev) => { /* no-op for interviewee */ };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.socket.emit('webrtc-offer', { sessionId: this.sessionId, sdp: offer });
    console.log('offer sent');
  }

  // ------------------- WebRTC: interviewer handles offer & creates answer -------------------
  private async handleRemoteOffer(sdp: any) {
    try {
      console.log('handleRemoteOffer');
      if (!this.pc) {
        this.pc = new RTCPeerConnection(this.getRtcConfig());
        this.remoteStream = new MediaStream();

        this.pc.ontrack = (ev) => {
          if (ev.streams && ev.streams[0]) {
            this.remoteStream = ev.streams[0];
          } else if (ev.track) {
            this.remoteStream!.addTrack(ev.track);
          }
          // attach remote to the existing videoElement
          if (this.videoElement && this.videoElement.nativeElement) {
            this.videoElement.nativeElement.srcObject = this.remoteStream;
            this.videoElement.nativeElement.play().catch(() => { });
          }
          this.cdr.detectChanges();
        };

        this.pc.onicecandidate = (ev) => {
          if (ev.candidate) this.socket.emit('webrtc-ice', { sessionId: this.sessionId, candidate: ev.candidate });
        };
      }

      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.socket.emit('webrtc-answer', { sessionId: this.sessionId, sdp: answer });
      console.log('answer sent');
    } catch (err) {
      console.error('handleRemoteOffer err', err);
    }
  }

  // interviewee handles answer
  private async handleRemoteAnswer(sdp: any) {
    try {
      if (!this.pc) return;
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log('remote answer applied');
    } catch (err) {
      console.error('handleRemoteAnswer err', err);
    }
  }

  // add ICE
  private async addRemoteIce(candidate: any) {
    try {
      if (!candidate || !this.pc) return;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('addRemoteIce error', err);
    }
  }

  // ------------------- chat & recording (unchanged) -------------------
  sendChat() {
    if (!this.chatText || !this.chatText.trim()) return;
    const payload = { sessionId: this.sessionId, name: this.name, message: this.chatText, timestamp: new Date().toISOString() } as ChatMessage;
    this.socket.emit('chat', payload);
    this.chatText = '';
  }

  // recording (interviewer) uses snapshotImage captureStream fallback
  startRecording() {
    if (this.role !== 'interviewer' || !this.snapshotImage || !this.snapshotImage.nativeElement) return;
    const stream = (this.snapshotImage.nativeElement as any).captureStream?.(25);
    if (!stream) { console.error('captureStream not supported'); return; }
    this.recordedBlobs = [];
    try { this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
    catch { this.mediaRecorder = new MediaRecorder(stream); }
    this.mediaRecorder.ondataavailable = (ev: BlobEvent) => { if (ev.data && ev.data.size) this.recordedBlobs.push(ev.data); };
    this.mediaRecorder.start(200);
    this.isRecording = true;
    this.logEvent('recording_started', {});
  }

  stopRecordingAndUpload() {
    if (!this.mediaRecorder) return;
    try { if (this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop(); } catch (e) { }
    this.isRecording = false;
    const blob = new Blob(this.recordedBlobs, { type: 'video/webm' });
    const fd = new FormData(); fd.append('sessionId', this.sessionId); fd.append('name', this.name); fd.append('video', blob, 'recording.webm');
    this.http.post('http://localhost:5000/upload-video', fd).subscribe({
      next: (res) => { console.log('Upload ok', res); this.logEvent('recording_uploaded', { size: blob.size }); },
      error: (err) => console.error('Upload failed', err)
    });
  }

  // logging helper
  logEvent(type: string, detail: any) {
    const ev = { sessionId: this.sessionId, role: this.role, name: this.name, type, detail, timestamp: new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})};
    this.http.post('http://localhost:5000/log', ev).subscribe({ error: err => console.warn('log failed', err) });
  }

  // icon helper used by events UI
  getIconForEventType(type: string): string {
    if (!type) return '';
    if (type.includes('focus') || type.includes('FOCUS')) return 'center_focus_weak';
    if (type.includes('no_face') || type.includes('NO_FACE')) return 'person_off';
    if (type.includes('multiple') || type.includes('MULTIPLE')) return 'people';
    if (type.includes('phone') || type.includes('PHONE')) return 'phone_android';
    if (type.includes('notes') || type.includes('NOTES')) return 'description';
    if (type.includes('mic')) return 'mic';
    if (type.includes('camera')) return 'videocam';
    if (type.includes('left')) return 'call_end';
    return '';
  }
}
