from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.orm import declarative_base
import datetime

Base = declarative_base()

class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(128), unique=True, nullable=False)
    name = Column(String(256))
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    video_path = Column(String(512), nullable=True)

class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String(128), nullable=False)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    role = Column(String(64))
    name = Column(String(256))
    type = Column(String(128))
    detail = Column(Text)
