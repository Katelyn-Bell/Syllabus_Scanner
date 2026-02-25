-- Run this in Supabase SQL Editor to add course/class support.
-- Adds a column so events can be grouped by class.

alter table public.events
  add column if not exists course_name text;

comment on column public.events.course_name is 'Course or class name (e.g. CPE 380, BIO 101), extracted from syllabus or set by user';
