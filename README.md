# Syllabus Scanner

Turn a syllabus PDF into calendar events: upload → extract text → Gemini extracts dates → save to Supabase.

**Stack:** React (frontend) → Supabase Storage + Auth → Python/FastAPI (backend) → Gemini → Supabase DB.

---

## Backend (Steps 1 & 2): Run the API locally

This walks you through running the Python API that processes a PDF URL and saves events to Supabase.

### 1. Create a virtual environment (recommended)

In the project folder:

```bash
cd "/Users/katelynbell/github /Syllabus_Scanner"
python3 -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
```

You should see `(venv)` in your terminal.

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, Supabase, Gemini, pypdf, and the rest.

### 3. Set up your `.env` file

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Then open `.env` in your editor and set:

| Variable | Where to get it |
|----------|------------------|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) → Create API key |
| `SUPABASE_URL` | Supabase dashboard → **Project Settings** → **API** → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page → **Project API keys** → `service_role` (secret) |

**Important:** Use the **service_role** key for the backend, not the anon key. Never put the service_role key in your frontend code.

### 4. Create the `events` table in Supabase (if you haven’t yet)

In Supabase: **SQL Editor** → New query → paste and run:

```sql
create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  source_filename text,
  source_url text,
  event_date date not null,
  event_title text not null,
  event_description text,
  created_at timestamptz not null default now()
);

create index events_user_date_idx on public.events (user_id, event_date);

alter table public.events enable row level security;

create policy "Users can select their own events"
  on public.events for select using (auth.uid() = user_id);
create policy "Users can insert their own events"
  on public.events for insert with check (auth.uid() = user_id);
```

(Your backend uses the service role, so it can insert regardless of RLS; RLS protects the frontend.)

**Optional – group events by class:** Run `supabase_add_course_name.sql` in the SQL Editor to add a `course_name` column so events can be organized by course.

### 5. Start the API server

From the project root (with `venv` activated):

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

You should see something like:

```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 6. Test the health endpoint

In another terminal (or browser):

```bash
curl http://localhost:8000/health
```

Expected: `{"status":"ok","message":"Syllabus Scanner API is running"}`

### 7. Test processing a syllabus (PDF URL)

The endpoint expects a **public URL** to a PDF. For a quick test you can:

- Upload a syllabus PDF to your Supabase Storage `syllabi` bucket and copy the public URL, or  
- Use any public PDF URL (e.g. a sample syllabus).

Then run (replace the URL with yours):

```bash
curl -X POST http://localhost:8000/process-syllabus \
  -H "Content-Type: application/json" \
  -d '{"file_url": "https://example.com/path/to/syllabus.pdf", "source_filename": "my_syllabus.pdf"}'
```

If something goes wrong (e.g. bad URL or missing env), the API will return an error message and status code. If it works, you’ll get JSON with `events` and `count`, and the same events will appear in the Supabase **Table Editor** for `events`.

---

## Frontend: React app (login, upload, view events)

### 1. Create the Storage bucket in Supabase (if you haven’t)

So the frontend can upload PDFs, you need a **Storage** bucket:

- In Supabase go to **Storage** → **New bucket**.
- Name: `syllabi`.
- Turn **Public bucket** ON (so the backend can download the PDF from the URL).
- Create the bucket.

Then add a policy so logged-in users can upload. In **SQL Editor** run:

```sql
create policy "Authenticated users can upload syllabi"
on storage.objects for insert
to authenticated
with check (bucket_id = 'syllabi');

create policy "Public read for syllabi"
on storage.objects for select
using (bucket_id = 'syllabi');
```

### 2. Install frontend dependencies

From the project root:

```bash
cd frontend
npm install
```

(You need Node.js and npm installed. If `npm` isn’t found, install Node from https://nodejs.org.)

### 3. Configure frontend environment variables

In the `frontend` folder:

```bash
cp .env.example .env
```

Edit `frontend/.env` and set:

| Variable | Where to get it |
|----------|------------------|
| `VITE_SUPABASE_URL` | Same as backend: Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Same page → **anon** `public` key (safe in the frontend) |
| `VITE_API_URL` | Your backend URL; locally use `http://localhost:8000` |

Save the file.

### 4. Start the backend (if not already running)

In one terminal, from the project root:

```bash
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Start the frontend

In another terminal:

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

### 6. Use the app

1. **Sign up** – Use any email and a password. (You can turn off “Confirm email” in Supabase → Authentication → Providers → Email for easier local testing.)
2. **Sign in** – After signing up or confirming, sign in.
3. **Upload a syllabus** – Choose a PDF file, then click “Upload & extract events”.
4. The app uploads to Storage, calls your backend with the file URL, and shows the extracted events below.

If the backend isn’t running or `VITE_API_URL` is wrong, you’ll see an error when you upload. Check that the backend is running at the URL in `frontend/.env`.

---

## Project layout (current)

- `backend/main.py` – FastAPI app: `GET /health`, `POST /process-syllabus`.
- `frontend/` – React (Vite) app: Supabase Auth, Storage upload, calls backend, shows events.
- `scanner.py` – Original script; kept for reference.
- `.env.example` and `frontend/.env.example` – Env templates. `.env` and `frontend/.env` – Your keys (git-ignored).
