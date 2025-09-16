from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, join_room, emit
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os, json, datetime, io
from models import Base, Session as SessionModel, Event as EventModel
from utils_report import generate_pdf
from detection import analyze_frame_b64

# setup
app = Flask(__name__)
CORS(app)
app.config['UPLOAD_FOLDER'] = 'static_uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# socketio
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# DB (SQLite)
engine = create_engine('sqlite:///proctoring.db', echo=False, connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
DBSession = sessionmaker(bind=engine)

@app.route('/start-session', methods=['POST'])
def start_session():
    data = request.get_json() or {}
    session_id = data.get('sessionId') or data.get('session_id') or (f"sess-{os.urandom(4).hex()}")
    name = data.get('name') or ''
    db = DBSession()
    # upsert
    existing = db.query(SessionModel).filter_by(session_id=session_id).first()
    if not existing:
        s = SessionModel(session_id=session_id, name=name)
        db.add(s); db.commit()
    db.close()
    return jsonify({'sessionId': session_id})

@app.route('/log', methods=['POST'])
def log_event():
    data = request.get_json() or {}
    session_id = data.get('sessionId')
    role = data.get('role')
    name = data.get('name')
    typ = data.get('type')
    detail = json.dumps(data.get('detail', {}))
    timestamp = data.get('timestamp')
    if timestamp:
        timestamp = datetime.datetime.fromisoformat(timestamp.replace('Z', '+05:30'))
    db = DBSession()
    ev = EventModel(session_id=session_id, role=role, name=name, type=typ, detail=detail, timestamp=timestamp or datetime.datetime.utcnow())
    db.add(ev); db.commit()
    db.close()
    # push to room via socketio
    socketio.emit('event', {
        'sessionId': session_id, 'role': role, 'name': name, 'type': typ,
        'detail': data.get('detail', {}), 'timestamp': timestamp.isoformat() if timestamp else datetime.datetime.utcnow().isoformat()
    }, room=session_id)
    return jsonify({'status':'ok'})

@app.route('/upload-video', methods=['POST'])
def upload_video():
    sid = request.form.get('sessionId') or request.form.get('session_id')
    name = request.form.get('name') or ''
    file = request.files.get('video')
    if not file:
        return jsonify({'error':'no file'}), 400
    filename = f"{sid}_{int(datetime.datetime.utcnow().timestamp())}.webm"
    path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(path)
    db = DBSession()
    session = db.query(SessionModel).filter_by(session_id=sid).first()
    if session:
        session.video_path = path
    db.commit()
    db.close()
    return jsonify({'status':'ok', 'path': path})

@app.route('/report/<session_id>', methods=['GET'])
def report(session_id):
    db = DBSession()
    events = db.query(EventModel).filter_by(session_id=session_id).order_by(EventModel.timestamp.desc()).all()
    db.close()
    # generate pdf buffer
    pdf_bytes = generate_pdf(events, session_id)
    return send_file(io.BytesIO(pdf_bytes), mimetype='application/pdf', download_name=f'{session_id}_report.pdf', as_attachment=True)

@app.route('/analyze-frame', methods=['POST'])
def analyze_frame():
    data = request.get_json() or {}
    session_id = data.get('sessionId')
    name = data.get('name', 'unknown')
    img_b64 = data.get('image')

    if not img_b64:
        return jsonify({"error": "no image"}), 400

    result = analyze_frame_b64(img_b64)

    # Save events to DB + emit to socket
    db = DBSession()
    for etype, detail in result["events"]:
        ev = EventModel(
            session_id=session_id,
            role="detector",
            name=name,
            type=etype,
            detail=json.dumps(detail),
            timestamp=datetime.datetime.utcnow()
        )
        db.add(ev); db.commit()
        socketio.emit("event", {
            "sessionId": session_id,
            "role": "detector",
            "name": name,
            "type": etype,
            "detail": detail,
            "timestamp": datetime.datetime.utcnow().isoformat()
        }, room=session_id)
    db.close()

    return jsonify(result)

# Socket handlers
@socketio.on('join')
def on_join(data):
    """Join a room and notify others"""
    room = data['sessionId']
    join_room(room)
    emit('event', {'msg': f"{data['name']} joined as {data['role']}"}, room=room)

@socketio.on('event')
def on_event(data):
    """Broadcast generic events"""
    sessionId = data.get('sessionId')
    emit('event', data, room=sessionId)

@socketio.on('snapshot')
def on_snapshot(data):
    """Broadcast snapshots from interviewee to interviewer"""
    sessionId = data.get('sessionId')
    emit('snapshot', data, room=sessionId)

@socketio.on('chat')
def on_chat(data):
    """
    Broadcast chat messages to everyone in the same session,
    including the sender.
    """
    room = data.get('sessionId')
    if not room:
        return
    emit('chat', data, room=room, include_self=True)

# Join handler (emit system event + return your own socket id)
@socketio.on('join')
def handle_join(data):
    session = data.get('sessionId')
    role = data.get('role')
    name = data.get('name')
    if session:
        join_room(session)
        # notify room
        emit('event', {
            'type': 'system',
            'detail': f'{name} ({role}) joined',
            'role': role,
            'name': name,
            'timestamp': datetime.datetime.utcnow().isoformat()
        }, room=session)
        # tell the joining client its own socket id (so client can ignore self-echo)
        emit('your-socket-id', {'sid': request.sid}, room=request.sid)

# WebRTC: offer (forward to room)
@socketio.on('webrtc-offer')
def webrtc_offer(data):
    room = data.get('sessionId')
    # forward offer to room, include sender sid so clients can ignore their own messages
    emit('webrtc-offer', {'sdp': data.get('sdp'), 'from': request.sid}, room=room)

# WebRTC: answer (forward to room)
@socketio.on('webrtc-answer')
def webrtc_answer(data):
    room = data.get('sessionId')
    emit('webrtc-answer', {'sdp': data.get('sdp'), 'from': request.sid}, room=room)

# WebRTC: ice candidates (forward to room)
@socketio.on('webrtc-ice')
def webrtc_ice(data):
    room = data.get('sessionId')
    emit('webrtc-ice', {'candidate': data.get('candidate'), 'from': request.sid}, room=room)

@socketio.on('frame')
def handle_frame(data):
    """
    Receive frame from interviewee, run detection, emit suspicious events
    """
    session_id = data.get("sessionId")
    name = data.get("name")
    role = data.get("role")
    frame = data.get("frame")  # base64 frame

    if not frame:
        return

    # Run analysis
    result_dict = analyze_frame_b64(frame) # Returns a dictionary
    print("Result", result_dict)
    
    # --- FIX STARTS HERE ---
    # Check if the result is a dictionary and has the 'events' key
    events_list = result_dict if isinstance(result_dict, list) else result_dict.get("events", [])

    for ev in events_list:
    # --- FIX ENDS HERE ---
        event_data = {
            "sessionId": session_id,
            "role": role,
            "name": name,
            "type": ev["type"],
            "detail": ev["detail"],
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }

        # Store in DB (reuse /log logic)
        db = DBSession()
        from models import Event as EventModel
        import json
        ev_model = EventModel(
            session_id=session_id,
            role=role,
            name=name,
            type=ev["type"],
            detail=json.dumps(ev["detail"]),
            timestamp=datetime.datetime.utcnow()
        )
        db.add(ev_model); db.commit(); db.close()

        # Emit to interviewer (live events)
        socketio.emit("event", event_data, room=session_id)

if __name__ == '__main__':
    print('Starting Flask-SocketIO server on http://localhost:5000')
    socketio.run(app, host='0.0.0.0', port=5000)
