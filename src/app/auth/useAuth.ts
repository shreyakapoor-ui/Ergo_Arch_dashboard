// =============================================================================
// useAuth — Google OAuth gate with 30-min inactivity timeout.
//
// Authentication is Google OAuth only (via Supabase Auth).
// `fullyAuthed` is true whenever a valid Supabase session exists.
// An inactivity timer clears the session and forces the user back to the
// sign-in screen after INACTIVITY_TIMEOUT_MS of silence.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import {
  INACTIVITY_TIMEOUT_MS,
  SESSION_LAST_ACTIVITY_KEY,
  USERS_TABLE,
} from "./authConstants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthState {
  /** The Supabase Auth user (Google OAuth), or null if not signed in. */
  googleUser: User | null;
  /** True only when a valid Google OAuth session exists. */
  fullyAuthed: boolean;
  /** True while we are resolving the initial Supabase session on mount. */
  loading: boolean;
  /** Non-null while Google OAuth redirect is in flight. */
  oauthLoading: boolean;
  /** Error string if Google sign-in fails. */
  oauthError: string | null;
}

export interface AuthActions {
  /** Kick off the Google OAuth flow (redirects to Google). */
  signInWithGoogle: () => Promise<void>;
  /** Sign out and clear the session. */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// useAuth
// ---------------------------------------------------------------------------

export function useAuth(): AuthState & AuthActions {
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fullyAuthed: Google session exists
  const fullyAuthed = googleUser !== null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Sign out of Supabase and clear local state. */
  const clearSession = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    setGoogleUser(null);
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

  // ── Inactivity tracking — attach listeners when signed in ─────────────────
  useEffect(() => {
    if (!fullyAuthed) {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      return;
    }

    const EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    const onActivity = () => resetInactivityTimer();

    EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
    resetInactivityTimer();

    return () => {
      EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [fullyAuthed, resetInactivityTimer]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    setOauthLoading(true);
    setOauthError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) {
      setOauthError(error.message);
      setOauthLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  return {
    googleUser,
    fullyAuthed,
    loading,
    oauthLoading,
    oauthError,
    signInWithGoogle,
    logout,
  };
}
