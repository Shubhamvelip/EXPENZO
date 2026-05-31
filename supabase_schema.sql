-- ═══════════════════════════════════════════════════════════════
-- EXPENZO DATABASE SCHEMA
-- Run this in your Supabase SQL Editor:
-- Supabase Dashboard → SQL Editor → New Query → paste & run
-- ═══════════════════════════════════════════════════════════════

-- ─── Enable UUID generation ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Drop existing tables to recreate with correct columns ─────
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- ─── Projects Table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT DEFAULT 'Personal',
  total_budget  FLOAT NOT NULL DEFAULT 1000.0,
  color         TEXT DEFAULT '#818CF8',
  icon          TEXT DEFAULT 'Folder',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── Expenses Table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  amount        FLOAT NOT NULL,
  date          DATE NOT NULL,
  category      TEXT NOT NULL DEFAULT 'Other',
  transcript    TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─── Row Level Security ────────────────────────────────────────
-- Enable RLS so users can only see their own data

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "Users can view own projects"
  ON projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own projects"
  ON projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
  ON projects FOR DELETE
  USING (auth.uid() = user_id);

-- Expenses policies
CREATE POLICY "Users can view own expenses"
  ON expenses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own expenses"
  ON expenses FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update own expenses"
  ON expenses FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own expenses"
  ON expenses FOR DELETE
  USING (auth.uid() = user_id);

-- ─── Indexes for performance ───────────────────────────────────
CREATE INDEX IF NOT EXISTS expenses_project_id_idx ON expenses(project_id);
CREATE INDEX IF NOT EXISTS expenses_user_id_idx ON expenses(user_id);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date DESC);
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);

-- ─── Sample seed data (optional — remove if not needed) ────────
-- INSERT INTO projects (name, type, total_budget, color, icon)
-- VALUES 
--   ('Goa Trip', 'Travel', 10000.0, '#2DD4BF', 'Plane'),
--   ('Monthly Personal', 'Personal', 5000.0, '#818CF8', 'Folder');
