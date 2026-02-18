// =============================================================================
// useAuth — dual-gate auth hook
//
// Gate 1: Shared app password  (access barrier, NOT identity)
// Gate 2: Google OAuth via Supabase Auth  (identity)
//
// Both gates must be satisfied for `fullyAuthed` to be true.
// An inactivity timer (INACTIVITY_TIMEOUT_MS) clears both gates and forces
// the user back to the UnlockScreen.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import {
  APP_PASSWORD,
  INACTIVITY_TIMEOUT_MS,
  SESSION_PW_KEY,
  SESSION_LAST_ACTIVITY_KEY,
  USERS_TABLE,
} from "./authConstants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthState {
  /** True once the user has entered the correct shared app password. */
  passwordPassed: boolean;
  /** The Supabase Auth user (Google OAuth), or null if not signed in. */
  googleUser: User | null;
  /** True only when BOTH gates are satisfied and session is still active. */
  fullyAuthed: boolean;
  /** True while we are resolving the initial Supabase session on mount. */
  loading: boolean;
  /** Non-null while Google OAuth is in flight. */
  oauthLoading: boolean;
  /** Error string if Google sign-in fails. */
  oauthError: string | null;
}

export interface AuthActions {
  /** Validate the shared password. Returns true on success. */
  submitPassword: (pw: string) => boolean;
  /** Kick off the Google OAuth flow (redirects). */
  signInWithGoogle: () => Promise<void>;
  /** Sign out of Google Auth AND clear the password gate. */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// useAuth
// ---------------------------------------------------------------------------

export function useAuth(): AuthState & AuthActions {
  // ── Gate 1: password ──────────────────────────────────────────────────────
  const [passwordPassed, setPasswordPassed] = useState<boolean>(() => {
    // Restore from sessionStorage so a page refresh doesn't force re-entry,
    // but also check that the activity timestamp hasn't expired.
    const passed = sessionStorage.getItem(SESSION_PW_KEY) === "true";
    if (!passed) return false;
    const lastActivity = Number(sessionStorage.getItem(SESSION_LAST_ACTIVITY_KEY) ?? "0");
    const expired = Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS;
    return !expired;
  });

  // ── Gate 2: Google OAuth ──────────────────────────────────────────────────
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // ── Inactivity timer ─────────────────────────────────────────────────────
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fullyAuthed: both gates must be satisfied
  const fullyAuthed = passwordPassed && googleUser !== null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Clear both gates and sign out of Supabase. */
  const clearSession = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    setPasswordPassed(false);
    setGoogleUser(null);
    sessionStorage.removeItem(SESSION_PW_KEY);
    sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    await supabase.auth.signOut();
  }, []);

  /** Reset the inactivity countdown. */
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
    inactivityTimer.current = setTimeout(() => {
      console.log("[auth] Inactivity timeout — clearing session.");
      clearSession();
    }, INACTIVITY_TIMEOUT_MS);
  }, [clearSession]);

  /** Upsert the user record in the `users` table for @mentions. */
  const upsertUserRecord = useCallback(async (user: User) => {
    const { error } = await supabase.from(USERS_TABLE).upsert(
      {
        id: user.id,
        email: user.email ?? "",
        name: user.user_metadata?.full_name ?? user.email ?? "",
        avatar_url: user.user_metadata?.avatar_url ?? null,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      // Non-fatal — @mentions will still work with email fallback
      console.warn("[auth] Could not upsert user record:", error.message);
    }
  }, []);

  // ── Bootstrap: resolve existing Supabase session on mount ─────────────────
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const user = session?.user ?? null;
      setGoogleUser(user);
      if (user) upsertUserRecord(user);
      setLoading(false);
    });

    // Listen for auth state changes (OAuth callback, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        if (!mounted) return;
        const user = session?.user ?? null;
        setGoogleUser(user);
        if (user) upsertUserRecord(user);
        setOauthLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [upsertUserRecord]);

  // ── Inactivity tracking — attach listeners when fully authed ──────────────
  useEffect(() => {
    if (!fullyAuthed) {
      // Clean up timer when session ends
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      return;
    }

    const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

    const onActivity = () => resetInactivityTimer();

    EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    resetInactivityTimer(); // start the clock immediately

    return () => {
      EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [fullyAuthed, resetInactivityTimer]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const submitPassword = useCallback((pw: string): boolean => {
    // ⚠️  Client-side comparison. See authConstants.ts for migration path.
    if (pw === APP_PASSWORD) {
      sessionStorage.setItem(SESSION_PW_KEY, "true");
      sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
      setPasswordPassed(true);
      return true;
    }
    return false;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setOauthLoading(true);
    setOauthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          // Request profile + email scopes
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setOauthError(error.message);
      setOauthLoading(false);
    }
    // On success the browser redirects; onAuthStateChange handles the callback.
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  return {
    passwordPassed,
    googleUser,
    fullyAuthed,
    loading,
    oauthLoading,
    oauthError,
    submitPassword,
    signInWithGoogle,
    logout,
  };
}
