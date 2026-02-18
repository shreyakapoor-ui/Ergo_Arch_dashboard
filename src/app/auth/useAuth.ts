// =============================================================================
// useAuth — Google OAuth gate with domain allowlist, role-based access,
//           and 30-min inactivity timeout.
//
// Authentication flow:
//   1. Google OAuth via Supabase Auth.
//   2. On sign-in, resolveUserAccess() is called:
//      a. Domain check — must be in ALLOWED_DOMAINS or user is signed out.
//      b. Role lookup  — queries public.user_roles by email.
//         - Active admin  → userRole = 'admin'
//         - Active member → userRole = 'member'
//         - No row yet    → auto-insert as 'member'
//         - inactive row  → sign out, accessDenied = true
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import {
  INACTIVITY_TIMEOUT_MS,
  SESSION_LAST_ACTIVITY_KEY,
  USERS_TABLE,
  ROLES_TABLE,
  ALLOWED_DOMAINS,
  type UserRole,
} from "./authConstants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthState {
  /** The Supabase Auth user (Google OAuth), or null if not signed in. */
  googleUser: User | null;
  /** True only when a valid Google OAuth session exists AND access is granted. */
  fullyAuthed: boolean;
  /** True while we are resolving the initial Supabase session on mount. */
  loading: boolean;
  /** Non-null while Google OAuth redirect is in flight. */
  oauthLoading: boolean;
  /** Error string if Google sign-in fails. */
  oauthError: string | null;
  /** The user's role ('admin' | 'member'), null if not yet resolved. */
  userRole: UserRole | null;
  /** True if signed in with Google but blocked by domain or deactivation. */
  accessDenied: boolean;
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
  const [googleUser, setGoogleUser]   = useState<User | null>(null);
  const [loading, setLoading]         = useState(true);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError]   = useState<string | null>(null);
  const [userRole, setUserRole]       = useState<UserRole | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // fullyAuthed: Google session exists AND user is allowed in
  const fullyAuthed = googleUser !== null && !accessDenied;

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Sign out of Supabase and clear all local state. */
  const clearSession = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    setGoogleUser(null);
    setUserRole(null);
    setAccessDenied(false);
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
        id:         user.id,
        email:      user.email ?? "",
        name:       user.user_metadata?.full_name ?? user.email ?? "",
        avatar_url: user.user_metadata?.avatar_url ?? null,
        last_seen:  new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      console.warn("[auth] Could not upsert user record:", error.message);
    }
  }, []);

  /**
   * Resolve the user's access:
   *   1. Domain allowlist check
   *   2. Role lookup / auto-provision
   */
  const resolveUserAccess = useCallback(async (user: User): Promise<void> => {
    // 1. Domain check
    const emailDomain = (user.email ?? "").split("@")[1] ?? "";
    const domainAllowed = (ALLOWED_DOMAINS as readonly string[]).includes(emailDomain);

    if (!domainAllowed) {
      console.warn(`[auth] Domain '${emailDomain}' not in allowlist — blocking.`);
      setAccessDenied(true);
      // Sign out silently so the Google session is cleared
      await supabase.auth.signOut();
      return;
    }

    // 2. Look up (or auto-create) the user_roles row
    const { data: roleRow, error: roleErr } = await supabase
      .from(ROLES_TABLE)
      .select("id, role, active, user_id")
      .eq("email", user.email ?? "")
      .maybeSingle();

    if (roleErr) {
      console.error("[auth] Role lookup error:", roleErr.message);
      // Fail open: treat as member so the user can still enter
    }

    if (roleRow) {
      // Row exists — check active flag
      if (!roleRow.active) {
        console.warn("[auth] User deactivated:", user.email);
        setAccessDenied(true);
        await supabase.auth.signOut();
        return;
      }
      setUserRole(roleRow.role as UserRole);

      // Back-fill user_id if the row was seeded before the user ever logged in
      if (!roleRow.user_id) {
        await supabase
          .from(ROLES_TABLE)
          .update({ user_id: user.id })
          .eq("id", roleRow.id);
      }
    } else {
      // No row — auto-provision as member
      const { error: insertErr } = await supabase.from(ROLES_TABLE).insert({
        user_id: user.id,
        email:   user.email ?? "",
        role:    "member",
        active:  true,
      });
      if (insertErr) {
        console.warn("[auth] Could not create user_roles row:", insertErr.message);
      }
      setUserRole("member");
    }

    // 3. Also keep the @mention user directory up to date
    await upsertUserRecord(user);
  }, [upsertUserRecord]);

  // ── Bootstrap: resolve existing Supabase session on mount ─────────────────
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      const user = session?.user ?? null;
      setGoogleUser(user);
      if (user) await resolveUserAccess(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event: string, session: Session | null) => {
        if (!mounted) return;
        const user = session?.user ?? null;
        setGoogleUser(user);
        if (user) await resolveUserAccess(user);
        setOauthLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveUserAccess]);

  // ── Inactivity tracking — attach listeners when fully signed in ────────────
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
    setAccessDenied(false);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: {
          access_type: "offline",
          prompt:      "select_account",
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
    userRole,
    accessDenied,
    signInWithGoogle,
    logout,
  };
}
