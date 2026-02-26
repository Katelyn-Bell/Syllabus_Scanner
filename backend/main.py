"""
Syllabus Scanner API – Step 1 & 2
- Receives a PDF URL, extracts text, sends to Gemini, saves events to Supabase.
"""
import io
import json
import os
import re
from datetime import datetime

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
from supabase import create_client, Client

# Load env first
load_dotenv()

# ----- Gemini setup (reuse your scanner logic) -----
import google.generativeai as genai

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel("gemini-2.5-flash")

# ----- Supabase client (created on first use so server can start even if key is wrong) -----
SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip()
SUPABASE_SERVICE_KEY = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or "").strip()

_supabase: Client | None = None


def get_supabase() -> Client:
    global _supabase
    if _supabase is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise ValueError(
                "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env. "
                "Copy .env.example to .env and fill in your Supabase project values."
            )
        _supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _supabase

# ----- FastAPI app -----
app = FastAPI(
    title="Syllabus Scanner API",
    description="Upload a syllabus PDF URL → extract events → save to Supabase",
)

# Allow the React frontend (local + deployed) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # any origin (OK for this student app)
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----- Request/response models -----
class ProcessSyllabusRequest(BaseModel):
    """What the frontend (or you) sends to process a syllabus."""

    file_url: str
    user_id: str | None = None
    source_filename: str | None = None
    course_name: str | None = None  # Optional; if not set, we extract from the syllabus with Gemini


class DeleteClassRequest(BaseModel):
    """Delete all events for a given user + course."""

    user_id: str
    course_name: str


# ----- Helpers -----
def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract text from PDF bytes (from a URL or file)."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text.strip()


def extract_course_and_events_with_gemini(syllabus_text: str) -> tuple[str | None, list[dict]]:
    """Send syllabus text to Gemini. Returns (course_name, list of event dicts)."""
    prompt = f"""
From the syllabus below, extract:
1) The course name or code (e.g. "CPE 380", "BIO 101", "CS 161"). Put it in a field called "course".
2) All assignments, exams, and important dates as a list called "events".

Return ONLY a single JSON object with this shape:
{{ "course": "Course Name or Code", "events": [ {{ "title": "...", "date": "YYYY-MM-DD", "type": "Assignment|Exam|Quiz|Project|..." }} ] }}

Use the date format YYYY-MM-DD for each event when possible.

Syllabus Text:
{syllabus_text}
"""
    response = gemini_model.generate_content(prompt)
    raw = (response.text or "").strip()

    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```\s*$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Gemini did not return valid JSON: {e}\nRaw: {raw[:500]}")

    # Accept { course, events } or legacy array-only format
    if isinstance(data, list):
        return None, data
    if isinstance(data, dict):
        course = (data.get("course") or "").strip() or None
        events = data.get("events")
        if events is None:
            events = []
        if not isinstance(events, list):
            events = [events] if isinstance(events, dict) else []
        return course, events
    return None, []


def parse_event_date(date_str: str) -> str:
    """Turn a date string from Gemini into YYYY-MM-DD for the database."""
    if not date_str:
        return datetime.now().strftime("%Y-%m-%d")
    # Already YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", str(date_str).strip()):
        return str(date_str).strip()
    # Try common formats
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%B %d, %Y", "%b %d, %Y", "%d %B %Y"):
        try:
            return datetime.strptime(str(date_str).strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return datetime.now().strftime("%Y-%m-%d")


# ----- Endpoints -----
@app.get("/health")
def health():
    """Check that the API is running. No secrets required."""
    return {"status": "ok", "message": "Syllabus Scanner API is running"}


@app.post("/process-syllabus")
def process_syllabus(body: ProcessSyllabusRequest):
    """Download PDF → Gemini → save to Supabase. Returns events."""
    try:
        return _process_syllabus_impl(body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Server error: {type(e).__name__}: {e}")


@app.post("/delete-class")
def delete_class(body: DeleteClassRequest):
    """Delete all events for a specific course for this user."""
    try:
        supa = get_supabase()
        (
            supa.table("events")
            .delete()
            .eq("user_id", body.user_id)
            .eq("course_name", body.course_name)
            .execute()
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Could not delete class events: {e}",
        )
    return {"status": "ok"}


def _process_syllabus_impl(body: ProcessSyllabusRequest):
    file_url = body.file_url.strip()
    user_id = body.user_id.strip() if body.user_id else None
    source_filename = (body.source_filename or "syllabus.pdf").strip()
    course_override = (body.course_name or "").strip() or None

    # 1. Download PDF
    try:
        resp = requests.get(file_url, timeout=30)
        resp.raise_for_status()
        pdf_bytes = resp.content
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Could not download PDF: {e}")

    if len(pdf_bytes) == 0:
        raise HTTPException(status_code=400, detail="PDF file is empty")

    # 2. Extract text and get course + events from Gemini
    try:
        text = extract_text_from_pdf_bytes(pdf_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if not text:
        raise HTTPException(status_code=400, detail="No text could be extracted from the PDF")

    try:
        course_from_ai, events_from_ai = extract_course_and_events_with_gemini(text)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    course_name = course_override or course_from_ai or "Unnamed course"

    # 3. Map to DB rows and insert into Supabase (include course_name)
    rows = []
    for ev in events_from_ai:
        title = ev.get("title") or "Untitled"
        date_str = ev.get("date") or ""
        event_type = ev.get("type") or ""
        rows.append({
            "user_id": user_id,
            "source_filename": source_filename,
            "source_url": file_url,
            "course_name": course_name,
            "event_date": parse_event_date(date_str),
            "event_title": title,
            "event_description": f"Type: {event_type}" if event_type else None,
        })

    if rows:
        try:
            get_supabase().table("events").insert(rows).execute()
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Could not save events to database: {e}",
            )

    return {"events": rows, "count": len(rows), "course_name": course_name}
