import csv
import io
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from models import Session, Event
import datetime

def generate_csv(events):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['timestamp','type','role','name','detail'])
    for e in events:
        writer.writerow([e.timestamp.isoformat(), e.type, e.role, e.name, e.detail])
    return output.getvalue().encode('utf-8')

def generate_pdf(events, session_id):
    # create a simple PDF report
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    c.setFont('Helvetica-Bold', 16)
    c.drawString(30, height - 40, f"Proctoring Report — Session {session_id}")
    c.setFont('Helvetica', 10)
    y = height - 80
    # summary info
    total_focus_loss = sum(1 for e in events if e.type in ('looking_away','no_face'))
    total_objects = sum(1 for e in events if e.type == 'object_detected')
    c.drawString(30, y, f"Generated: {datetime.datetime.utcnow().isoformat()} UTC")
    y -= 20
    c.drawString(30, y, f"Total focus loss events: {total_focus_loss}")
    y -= 16
    c.drawString(30, y, f"Total object_detected events: {total_objects}")
    y -= 26
    # list events
    c.setFont('Helvetica', 9)
    for e in events:
        if y < 60:
            c.showPage()
            y = height - 40
        c.drawString(30, y, f"{e.timestamp.isoformat()} | {e.type} | {e.role} | {e.name} | {e.detail[:120]}")
        y -= 14
    c.save()
    buffer.seek(0)
    return buffer.read()
