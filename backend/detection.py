# detection.py
import cv2
import mediapipe as mp
import numpy as np
import base64
import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

# Mediapipe setup
mp_face_detection = mp.solutions.face_detection
face_detector = mp_face_detection.FaceDetection(min_detection_confidence=0.5)

# Load pre-trained MobileNet SSD (for phones, books, etc.)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
proto = os.path.join(BASE_DIR, "models", "MobileNetSSD_deploy.prototxt")
model = os.path.join(BASE_DIR, "models", "MobileNetSSD_deploy.caffemodel")

net = cv2.dnn.readNetFromCaffe(proto, model)

# COCO labels supported by MobileNetSSD
CLASSES = ["background", "aeroplane", "bicycle", "bird", "boat",
           "bottle", "bus", "car", "cat", "chair", "cow", "diningtable",
           "dog", "horse", "motorbike", "person", "pottedplant", "sheep",
           "sofa", "train", "tvmonitor", "cell phone", "book"]   # added "book" manually


def decode_frame(frame_b64: str):
    """Convert base64 → cv2 image"""
    img_data = base64.b64decode(frame_b64.split(",")[-1])
    nparr = np.frombuffer(img_data, np.uint8)
    return cv2.imdecode(nparr, cv2.IMREAD_COLOR)


def analyze_frame_b64(frame_b64: str):
    """
    Analyze a frame for:
    - Face presence (none / multiple faces)
    - Suspicious objects (phone, book, monitor, etc.)
    """
    frame = decode_frame(frame_b64)
    h, w = frame.shape[:2]
    events = []

    # ---------- Face Detection ----------
    results = face_detector.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    faces = results.detections if results.detections else []

    if len(faces) == 0:
        events.append({
            "type": "no_face_detected",
            "detail": {"message": "No face found"}
        })
    elif len(faces) > 1:
        events.append({
            "type": "multiple_faces_detected",
            "detail": {"count": len(faces)}
        })

    # ---------- Object Detection (phones etc.) ----------
    blob = cv2.dnn.blobFromImage(cv2.resize(frame, (300, 300)),
                                 scalefactor=0.007843,
                                 size=(300, 300),
                                 mean=127.5)
    net.setInput(blob)
    detections = net.forward()

    h, w = frame.shape[:2]
    for i in range(detections.shape[2]):
        confidence = detections[0, 0, i, 2]
        if confidence > 0.3:
            idx = int(detections[0, 0, i, 1])
            label = CLASSES[idx] if idx < len(CLASSES) else "unknown"
            if label in ["cell phone", "book", "tvmonitor", "cellphone", "keyboard"]:
                events.append({
                    "type": "object_detected",
                    "detail": {"object": label, "confidence": float(confidence)}
                })

    return events
