import { 
  Room, 
  RoomEvent, 
  RemoteTrack, 
  Track, 
  createLocalTracks,
  LocalVideoTrack
} from 'livekit-client';

// Interfaces
export interface BoundingBox {
  class: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DetectionPayload {
  boxes: BoundingBox[];
}

const WIDTH = 640;
const HEIGHT = 480;

class EdgeVisualizer {
  private room: Room;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private videoElement: HTMLVideoElement;
  private currentLatency: number = 0;

  constructor(videoTagId: string, canvasId: string) {
    this.room = new Room();
    this.videoElement = document.getElementById(videoTagId) as HTMLVideoElement;
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;

    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    
    this.ctx = this.canvas.getContext('2d')!;
    this.setupListeners();
  }

  private setupListeners() {
    // Listen for remote tracks (e.g. from your Python script)
    this.room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      console.log("✅ Track subscribed:", track.kind);
      if (track.kind === Track.Kind.Video) {
        track.attach(this.videoElement);
        this.videoElement.play().catch(console.error);
      }
    });

    // Listen for data (bounding boxes)
    this.room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant, _kind, topic) => {
      if (topic === 'pong') {
        console.log("Received pong");
        const sentTime = parseFloat(new TextDecoder().decode(payload));
        this.currentLatency = Date.now() - sentTime;
        console.log(`⏱️ Round Trip Latency: ${this.currentLatency}ms`);
      }
      if (topic === 'bounding_boxes') {
        try {
          const data: DetectionPayload = JSON.parse(new TextDecoder().decode(payload));
          this.renderDetections(data.boxes);
        } catch (e) {
          console.error("Failed to parse coordinates", e);
        }
      }
    });
  }

  public startLatencyTest() {
    setInterval(() => {
      if (this.room.state === 'connected') {
        console.log("Sending ping");
        const now = Date.now().toString();
        this.room.localParticipant.publishData(
          new TextEncoder().encode(now),
          { topic: 'ping' }
        );
      }
    }, 1000); // Check every second
  }

  /**
   * THE JS EQUIVALENT OF YOUR PYTHON PUBLISH LOGIC
   */
  async publishLocalWebcam() {
    // CRITICAL: Check if we are actually connected first
    if (this.room.state !== 'connected') {
      console.warn("⏳ Room not fully connected yet. Waiting...");
      // Optional: add a small delay or a listener for the Connected event
    }

    try {
      const tracks = await createLocalTracks({
        video: { resolution: { width: WIDTH, height: HEIGHT } },
        audio: false,
      });

      console.log("📸 Local tracks created, attempting to publish...");
      
      // Use a small timeout or retry logic if the engine is warming up
      await this.room.localParticipant.publishTrack(tracks[0], {
        name: "webcam",
        source: Track.Source.Camera
      });

      console.log("🚀 Local webcam published!");
      tracks[0].attach(this.videoElement);
    } catch (e) {
      console.error("❌ Failed to publish local webcam:", e);
    }
  }

  private renderDetections(boxes: BoundingBox[]) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.fillStyle = '#ff0000';
    this.ctx.font = 'bold 16px monospace';
    this.ctx.fillText(`LATENCY: ${this.currentLatency}ms`, WIDTH - 150, 30);

    boxes.forEach(box => {
      const x = box.x1 * this.canvas.width;
      const y = box.y1 * this.canvas.height;
      const width = (box.x2 - box.x1) * this.canvas.width;
      const height = (box.y2 - box.y1) * this.canvas.height;

      this.ctx.strokeStyle = '#00FF41'; 
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(x, y, width, height);

      const label = `${box.class} ${Math.round(box.confidence * 100)}%`;
      this.ctx.font = 'bold 14px Arial';
      const textWidth = this.ctx.measureText(label).width;
      this.ctx.fillStyle = '#00FF41';
      this.ctx.fillRect(x, y - 22, textWidth + 10, 22);
      this.ctx.fillStyle = '#000000';
      this.ctx.fillText(label, x + 5, y - 6);
    });
  }

  async start(url: string, token: string) {
    console.log("🚀 Connecting...");
    try {
      await this.room.connect(url, token, {
        autoSubscribe: true,
        rtcConfig: { iceTransportPolicy: 'relay' }
      });
      console.log("✅ Connected!");
    } catch (e) {
      console.error("❌ Connection failed:", e);
    }
  }
}

// --- Init ---
const visualizer = new EdgeVisualizer("webcam", "overlay");
const url = "wss://controlled-mayhem-64qvp6u1.livekit.cloud";
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZSwicm9vbSI6ImVkZ2UtY3YiLCJjYW5QdWJsaXNoIjp0cnVlLCJjYW5TdWJzY3JpYmUiOnRydWUsImNhblB1Ymxpc2hEYXRhIjp0cnVlfSwic3ViIjoid2ViLWNsaWVudCIsImlzcyI6IkFQSXFvVVloenhadnVEUyIsIm5iZiI6MTc3MjA4MzY5NSwiZXhwIjoxNzcyMTA1Mjk1fQ.kpkQTu1Mk6lbLTvAVTzTAt5iPUGie9927bgByvcrmP8";

document.getElementById('connect-btn')?.addEventListener('click', async () => {
  await visualizer.start(url, token);
  
  // After connecting, start publishing just like the Python script does
  await visualizer.startLatencyTest();
  await visualizer.publishLocalWebcam();
  
  document.getElementById('container')!.style.display = 'block';
  document.getElementById('connect-btn')!.style.display = 'none';
});