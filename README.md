# Remote Proctoring System

This project implements a full-stack remote proctoring solution with **real-time monitoring, event detection, and reporting**. It enables interviewers or examiners to supervise candidates through live video, while the system automatically detects suspicious behavior such as loss of focus, multiple faces, or unauthorized objects like phones or notes.

---

## Table of Contents
- [Features](#features)
- [System Workflow](#system-workflow)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Reports](#reports)
- [Future Improvements](#future-improvements)
- [License](#license)

---

## Features

### Frontend (Angular)
- WebRTC-based **live video streaming** between interviewer and interviewee.
- **Live Events Panel** showing detected events in real time:
  - Candidate looking away or not visible.
  - Multiple faces in the frame.
  - Suspicious object detection (phone, books, monitors).
- Chat system for communication.
- Session-based view (interviewer and interviewee roles).

### Backend (Flask + Socket.IO)
- **WebSocket (Socket.IO)** for real-time communication between client and server.
- **REST APIs** for session management, logging, and report generation.
- **Event detection pipeline** using:
  - **MediaPipe** for face detection.
  - **OpenCV DNN + MobileNetSSD** for object detection.
- **SQLite database** to store sessions, logs, and video references.
- **Automated Report Generation** in PDF format containing:
  - Candidate name and session ID.
  - Session duration.
  - Logged events (focus loss, multiple faces, suspicious objects).
  - Integrity score calculation.

---

## System Workflow

1.  **Start Session**
    - The interviewee joins a session, and the video stream begins.
    - The interviewer joins the same session to view the live stream and monitor events.

2.  **Frame Analysis**
    - Frames from the interviewee’s camera are periodically sent to the backend.
    - The backend analyzes frames for:
      - Face presence (none, single, multiple).
      - Object detection (phones, books, etc.).
    - Detected events are logged in the database and pushed to the interviewer's UI in real time.

3.  **Event Logging**
    - Events are stored with the following details:
      - `type` (e.g., `no_face_detected`, `multiple_faces_detected`, `object_detected`).
      - `detail` (extra metadata such as object type or face count).
      - `timestamp`.

4.  **Reporting**
    - After the session concludes, a detailed **PDF report** can be generated.
    - The report includes a full timeline of suspicious events and a final integrity score.

---

## Tech Stack

| Area      | Technology / Library                                       |
|-----------|------------------------------------------------------------|
| **Frontend** | `Angular`, `WebRTC`, `Socket.IO Client`                    |
| **Backend** | `Flask`, `Flask-SocketIO`, `SQLAlchemy` (SQLite)           |
| **AI/ML** | `OpenCV`, `MediaPipe`, `TensorFlow`                      |
| **Reporting** | `ReportLab` (PDF generation)                               |

---

## Installation

### Prerequisites
- Python 3.10 or higher
- Node.js and Angular CLI
- `pip` and `virtualenv`
- A modern browser supporting WebRTC (Chrome, Firefox, Edge)

### Backend Setup
1.  Clone the repository:
    ```bash
    git clone [https://github.com/your-repo/proctoring-system.git](https://github.com/your-repo/proctoring-system.git)
    cd proctoring-system/backend
    ```
2.  Create and activate a virtual environment:
    ```bash
    # For Linux / macOS
    python3 -m venv venv
    source venv/bin/activate

    # For Windows
    python -m venv venv
    venv\Scripts\activate
    ```
3.  Install the required dependencies:
    ```bash
    pip install -r requirements.txt
    ```
4.  Start the backend server:
    ```bash
    python app.py
    ```
    The server will be running on `http://localhost:5000`.

### Frontend Setup
1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Install npm dependencies:
    ```bash
    npm install
    ```
3.  Start the Angular development server:
    ```bash
    ng serve
    ```
    The application will be available at `http://localhost:4200`.

---

## API Endpoints

### REST APIs

-   **`POST /start-session`** → Starts or resumes a session.
-   **`POST /log`** → Manually logs an event.
-   **`POST /upload-video`** → Uploads the recorded video of a candidate.
-   **`GET /report/<session_id>`** → Generates and returns a PDF report for a given session.

### WebSocket Events

-   **`join`** → Joins a client to a specific session room.
-   **`event`** → Broadcasts a detected event to the room.
-   **`snapshot`** → Sends a frame snapshot from the candidate to the interviewer.
-   **`frame`** → Streams video frames to the backend for analysis.
-   **`chat`** → Sends or receives chat messages within the room.

---

## Database Schema

### `Session` Table

| Column       | Type    | Description                               |
|--------------|---------|-------------------------------------------|
| `session_id` | String  | Primary Key, unique identifier for the session. |
| `name`       | String  | Name of the candidate or session.         |
| `video_path` | String  | Filesystem path to the recorded video.    |

### `Event` Table

| Column       | Type      | Description                               |
|--------------|-----------|-------------------------------------------|
| `id`         | Integer   | Primary Key, auto-incrementing.           |
| `session_id` | String    | Foreign key linking to the Session table. |
| `role`       | String    | Role of the person triggering the event.  |
| `name`       | String    | Name of the event (e.g., "Object Detected"). |
| `type`       | String    | Category of the event (e.g., `object_detected`). |
| `detail`     | String    | Additional details (e.g., "Phone").     |
| `timestamp`  | DateTime  | Timestamp of when the event occurred.     |

---

## Reports

Each session generates a comprehensive PDF report that includes:

-   Candidate name and session ID.
-   Session start and end times.
-   A chronological timeline of all detected events.
-   A summary with counts of each type of suspicious event.
-   A final integrity score (calculated as 100 minus deductions for each event).

---

## Future Improvements

-   **Model Enhancement**: Upgrade the object detection model to a more advanced architecture like YOLOv5/YOLOv8 for higher accuracy and speed.
-   **Gaze Tracking**: Implement gaze tracking to more precisely measure candidate attention and focus.
-   **Real-time Alerts**: Add real-time notifications for critical suspicious activities (e.g., via email or SMS).
-   **Scalability**: Deploy the application to a cloud platform (AWS, GCP, Azure) for improved scalability and availability.

---

## License

This project is intended for educational and demonstration purposes. All pre-trained models used (e.g., MediaPipe, MobileNetSSD) are subject to their respective licenses.
