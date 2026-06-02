import { supabase } from './supabase';

/**
 * Sign up a new user with email, password, and display name.
 * Returns { user, session, error }.
 */
export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
    },
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign in an existing user with email and password.
 * Returns { user, session, error }.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}

/**
 * Sign out the currently authenticated user.
 */
export async function signOut() {
  await supabase.auth.signOut();
}

/**
 * Get the current session. Returns null if not authenticated.
 */
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}

/**
 * Get the currently authenticated user object.
 */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

