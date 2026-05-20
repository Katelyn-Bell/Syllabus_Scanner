# Syllabus Scanner

Upload a syllabus PDF, get assignments and exam dates extracted with AI, organize them by class, view a calendar, and export to Google or Apple Calendar.

**Live stack:** React (Vite) on [Vercel](https://vercel.com) → Supabase Auth + Storage → Python/FastAPI on [Render](https://render.com) → Google Gemini → Supabase Postgres.

---

## Features

- **Sign up / sign in** (Supabase Auth, email confirmation)
- **Upload multiple syllabi** (PDF → Supabase Storage → backend processes with Gemini)
- **Events grouped by class** (course name from PDF or optional manual label)
- **Filters:** All, Assignments (includes homework, excludes projects), Projects, Exams
- **List and calendar views** (click a day to see events)
- **Color-coded classes**
- **Delete class** (removes all events for that course)
- **Download .ics** (import into Google Calendar or Apple Calendar)
- **Vercel Web Analytics** (optional; enable in Vercel dashboard)

---

## Project layout

| Path | Purpose |
|------|---------|
| `backend/main.py` | FastAPI: `GET /health`, `POST /process-syllabus`, `POST /delete-class` |
| `frontend/` | React (Vite) app |
| `scanner.py` | Original local script (reference) |
| `supabase_add_course_name.sql` | SQL to add `course_name` column to `events` |
| `runtime.txt` | Python version hint for Render (`python-3.11.9`) |
| `.env.example` | Backend secrets template |
| `frontend/.env.example` | Frontend env template |
| `requirements.txt` | Python dependencies (minimal pins) |

Secrets live in `.env` and `frontend/.env` (git-ignored).

---

## Supabase setup (one time)

### 1. `events` table

In **SQL Editor**, run:

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

### 2. `course_name` column (recommended)

Run the contents of `supabase_add_course_name.sql` in the SQL Editor.

### 3. Storage bucket `syllabi`

- **Storage** → **New bucket** → name `syllabi`, **Public bucket** ON.

Then:

```sql
create policy "Authenticated users can upload syllabi"
on storage.objects for insert
to authenticated
with check (bucket_id = 'syllabi');

create policy "Public read for syllabi"
on storage.objects for select
using (bucket_id = 'syllabi');
```

### 4. Who signed up?

Supabase → **Authentication** → **Users** (emails and sign-up dates).  
For traffic, enable **Vercel Web Analytics** on your Vercel project.

---

## Run locally

### Backend

```bash
cd "/path/to/Syllabus_Scanner"
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Test: `http://localhost:8000/health`

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL=http://localhost:8000
npm run dev
```

Open `http://localhost:5173`.

---

## Deploy

### Backend (Render)

| Setting | Value |
|---------|--------|
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| Env vars | `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

Use the **service_role** key on the backend only, never in the frontend.

### Frontend (Vercel)

| Setting | Value |
|---------|--------|
| Root directory | **`frontend`** (required) |
| Framework | Vite |
| Build command | `npm run build` (default) |
| Output | `dist` (default) |
| Env vars | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` = your Render URL |

After deploy, set `VITE_API_URL` to `https://your-api.onrender.com` (no trailing slash).

**If the live site looks old** (missing Delete class, wrong heading): confirm Vercel **Root Directory** is `frontend`, redeploy the latest commit on `main`, then hard-refresh the browser (`Cmd+Shift+R`).

### Share your link

Use the full URL with `https://` so it is clickable, e.g. `https://your-app.vercel.app`.

---

## Calendar export (.ics)

1. Use filters if you want (e.g. Exams only).
2. Click **Download .ics**.
3. **Google Calendar:** Settings → Import & export → Import → choose the file.
4. **Apple Calendar:** Double-click the `.ics` file → choose a calendar.

---

## API reference

| Method | Path | Body |
|--------|------|------|
| GET | `/health` | — |
| POST | `/process-syllabus` | `{ "file_url", "user_id?", "source_filename?", "course_name?" }` |
| POST | `/delete-class` | `{ "user_id", "course_name" }` |

---

## Troubleshooting

- **Upload fails on live site:** Check `VITE_API_URL` points to Render; backend CORS allows your Vercel origin (backend uses `allow_origins=["*"]`).
- **Invalid API key (frontend):** Use Supabase **anon** key in `frontend/.env`, not service_role.
- **Render build fails on dependencies:** Use the short `requirements.txt` in the repo (unpinned top-level packages).
- **Vercel shows old UI:** Root directory must be `frontend`; push latest `main` and redeploy.
