import asyncio
import json
import logging
import os
import threading

import cv2
import imageio.v3 as iio
import numpy as np
from dotenv import load_dotenv
from livekit import api, rtc

load_dotenv(".env.local")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("edge-client")

WIDTH, HEIGHT = 640, 480

_latest_boxes: list = []
_boxes_lock = threading.Lock()
_class_colours: dict[str, tuple] = {}

def _colour_for(class_name: str) -> tuple:
    if class_name not in _class_colours:
        h = hash(class_name) % 179  # hue 0-179 for OpenCV
        bgr = cv2.cvtColor(np.uint8([[[h, 200, 220]]]), cv2.COLOR_HSV2BGR)[0][0]
        _class_colours[class_name] = tuple(int(c) for c in bgr)
    return _class_colours[class_name]


def _draw_boxes(frame_rgb: np.ndarray, boxes: list) -> np.ndarray:
    img = cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR)
    for box in boxes:
        x1 = int(box["x1"] * WIDTH)
        y1 = int(box["y1"] * HEIGHT)
        x2 = int(box["x2"] * WIDTH)
        y2 = int(box["y2"] * HEIGHT)
        label = f"{box['class']} {box['confidence']:.2f}"
        colour = _colour_for(box["class"])
        cv2.rectangle(img, (x1, y1), (x2, y2), colour, 2)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        cv2.rectangle(img, (x1, y1 - th - 6), (x1 + tw + 4, y1), colour, -1)
        cv2.putText(img, label, (x1 + 2, y1 - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
    return img  # BGR for cv2.imshow


async def capture_frames(source: rtc.VideoSource):
    """Capture webcam frames, publish them, and display with bounding boxes."""
    cam = iio.imiter("<video0>", size=(WIDTH, HEIGHT))
    logger.info("Webcam streaming...")
    cv2.namedWindow("Edge Client – Live Detections", cv2.WINDOW_NORMAL)
    try:
        for frame in cam:
            video_frame = rtc.VideoFrame(WIDTH, HEIGHT, rtc.VideoBufferType.RGB24, frame.tobytes())
            source.capture_frame(video_frame)

            # Overlay the latest boxes and show in window.
            with _boxes_lock:
                boxes_snapshot = list(_latest_boxes)
            display = _draw_boxes(frame, boxes_snapshot)
            cv2.imshow("Edge Client – Live Detections", display)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

            await asyncio.sleep(0)  # yield to event loop
    finally:
        cam.close()
        cv2.destroyAllWindows()
        
def generate_token(identity: str):
    api_key = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    token = (
        api.AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_grants(api.VideoGrants(
                room_join=True, 
                room="edge-cv",
            ))
            .to_jwt()
    )
    
    print(f"TOKEN:\n{token}")
    return token


async def main():
    url = os.environ["LIVEKIT_URL"]
    api_key = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    room_name = os.environ.get("LIVEKIT_ROOM", "edge-cv")

    token = generate_token("edge-client")
    generate_token("web-client")

    room = rtc.Room()

    @room.on("data_received")
    def on_data_received(data: rtc.DataPacket):
        global _latest_boxes
        
        if data.topic == "ping":
            room.local_participant.publish_data(data.data, topic="pong")
            
        if data.topic == "bounding_boxes":
            payload = json.loads(data.data.decode())
            boxes = payload.get("boxes", [])
            with _boxes_lock:
                _latest_boxes = boxes
            if boxes:
                print(f"Detected {len(boxes)} object(s):")
                for i, box in enumerate(boxes):
                    print(f"  [{i}] {box['class']} conf={box['confidence']:.2f} x1={box['x1']:.3f} y1={box['y1']:.3f} x2={box['x2']:.3f} y2={box['y2']:.3f}")

    logger.info(f"Connecting to room: {room_name}")
    await room.connect(url, token)
    logger.info("Connected, publishing video...")

    source = rtc.VideoSource(WIDTH, HEIGHT)
    track = rtc.LocalVideoTrack.create_video_track("webcam", source)
    await room.local_participant.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA))

    try:
        await capture_frames(source)
    except asyncio.CancelledError:
        pass
    finally:
        await room.disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
