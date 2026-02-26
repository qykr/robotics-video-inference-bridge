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