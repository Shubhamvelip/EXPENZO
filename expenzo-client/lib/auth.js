import { supabase } from './supabase';

/**
 * Sign up a new user with email, password, and display name.
 * Returns { user, session, error }.
 */
export async function signUp(email, password, name) {
  console.log('[Auth] signUp (bypassed) for:', email);
  const mockUser = {
    id: 'mock-user-id',
    email,
    user_metadata: { full_name: name },
  };
  const mockSession = {
    access_token: 'mock-access-token',
    user: mockUser,
  };
  return { user: mockUser, session: mockSession, error: null };
}

/**
 * Sign in an existing user with email and password.
 * Returns { user, session, error }.
 */
export async function signIn(email, password) {
  console.log('[Auth] signIn (bypassed) for:', email);
  const mockUser = {
    id: 'mock-user-id',
    email: email || 'user@example.com',
    user_metadata: { full_name: 'Mock User' },
  };
  const mockSession = {
    access_token: 'mock-access-token',
    user: mockUser,
  };
  return { user: mockUser, session: mockSession, error: null };
}

/**
 * Sign out the currently authenticated user.
 */
export async function signOut() {
  console.log('[Auth] signOut (bypassed)');
}

/**
 * Get the current session. Returns null if not authenticated.
 */
export async function getSession() {
  // Return null so users are directed to the onboarding/login screens.
  // Once they log in or sign up, their session state will be updated.
  return null;
}

/**
 * Get the currently authenticated user object.
 */
export async function getCurrentUser() {
  return {
    id: 'mock-user-id',
    email: 'user@example.com',
    user_metadata: { full_name: 'Mock User' },
  };
}
