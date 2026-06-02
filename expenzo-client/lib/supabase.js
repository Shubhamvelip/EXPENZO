import { createClient } from '@supabase/supabase-js';

// ─── Supabase Configuration ───────────────────────────────────────────────────
// Replace SUPABASE_ANON_KEY with your actual anon key from:
// Supabase Dashboard → Project Settings → API → anon public key
const SUPABASE_URL = 'https://yqvjsmemxhbghvipwkap.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxdmpzbWVteGhiZ2h2aXB3a2FwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNTM4NzIsImV4cCI6MjA5NTcyOTg3Mn0.3-3g_Gxw78y3FygU1pgOCK5HrOtW4QBQFWej48LGD80';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// ─── Projects Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch all projects for the currently authenticated user.
 * Returns an array of project objects.
 */
export async function getProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[Supabase] getProjects error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Insert a new project row into the projects table.
 * Returns the newly created project object.
 */
export async function insertProject({ name, total_budget, type = 'Personal', color = '#818CF8', icon = 'Folder' }) {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || null;

  const { data, error } = await supabase
    .from('projects')
    .insert([{
      name,
      total_budget: parseFloat(total_budget),
      type,
      color,
      icon,
      user_id: userId,
    }])
    .select();

  if (error) {
    console.error('[Supabase] insertProject error:', error.message);
    throw error;
  }
  return data?.[0] || null;
}

// ─── Expenses Helpers ─────────────────────────────────────────────────────────

/**
 * Fetch all expenses, optionally filtered by project_id.
 * Returns an array of expense objects ordered newest-first.
 */
export async function getExpenses(projectId = null) {
  let query = supabase
    .from('expenses')
    .select('*')
    .order('date', { ascending: false });

  if (projectId) {
    query = query.eq('project_id', projectId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[Supabase] getExpenses error:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Insert a new expense row into the expenses table.
 * Returns the newly created expense object.
 */
export async function insertExpense({ project_id, amount, date, category, transcript }) {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || null;

  const { data, error } = await supabase
    .from('expenses')
    .insert([{
      project_id,
      amount: parseFloat(amount),
      date,
      category,
      transcript: transcript || '',
      user_id: userId,
    }])
    .select();

  if (error) {
    console.error('[Supabase] insertExpense error:', error.message);
    throw error;
  }
  return data?.[0] || null;
}
