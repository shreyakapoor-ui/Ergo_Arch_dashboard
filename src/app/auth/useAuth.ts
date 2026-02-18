// =============================================================================
// useAuth — Google OAuth only, 30-min inactivity timeout.
// Roles and domain checks happen in the background AFTER the user is let in.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import {
  INACTIVITY_TIMEOUT_MS,
  SESSION_LAST_ACTIVITY_KEY,
  USERS_TABLE,
  ROLES_TABLE,
  ALLOWED_DOMAINS,
  type UserRole,
} from "./authConstants";

export interface AuthState {
  googleUser: User | null;
  fullyAuthed: boolean;
  loading: boolean;
  oauthLoading: boolean;
  oauthError: string | null;
  userRole: UserRole | null;
  accessDenied: boolean;
}

export interface AuthActions {
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): AuthState & AuthActions {
  const [googleUser, setGoogleUser]     = useState<User | null>(null);
  const [loading, setLoading]           = useState(true);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError]     = useState<string | null>(null);
  const [userRole, setUserRole]         = useState<UserRole | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // User is fully authed as soon as Google session exists and not denied
  const fullyAuthed = googleUser !== null && !accessDenied;

  // ── inactivity timer ──────────────────────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
    inactivityTimer.current = setTimeout(async () => {
      console.log("[auth] Inactivity timeout.");
      setGoogleUser(null);
      setUserRole(null);
      setAccessDenied(false);
      sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
      await supabase.auth.signOut();
    }, INACTIVITY_TIMEOUT_MS);
  }, []);

  // ── bootstrap: one-time session check ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      const user = session?.user ?? null;
      setGoogleUser(user);
      setLoading(false); // ← always called, no await before it

      // Background: check domain + role (never blocks the UI)
      if (user) {
        checkAccessInBackground(user);
      }
    }).catch((err) => {
      console.error("[auth] getSession failed:", err);
      if (!cancelled) setLoading(false);
    });

    // Listen for sign-in / sign-out events (OAuth redirect lands here)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (cancelled) return;
        const user = session?.user ?? null;
        setGoogleUser(user);
        setLoading(false);
        setOauthLoading(false);

        if (user) {
          checkAccessInBackground(user);
        } else {
          // Signed out — reset role state
          setUserRole(null);
          setAccessDenied(false);
        }
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── background access check (never blocks loading) ────────────────────────
  const checkAccessInBackground = async (user: User) => {
    try {
      // 1. Domain check
      const domain = (user.email ?? "").split("@")[1] ?? "";
      if (!(ALLOWED_DOMAINS as readonly string[]).includes(domain)) {
        console.warn("[auth] Domain not allowed:", domain);
        setAccessDenied(true);
        supabase.auth.signOut().catch(() => {});
        return;
      }

      // 2. Role lookup — fire and forget if table doesn't exist yet
      const { data: row, error } = await supabase
        .from(ROLES_TABLE)
        .select("id, role, active, user_id")
        .eq("email", user.email ?? "")
        .maybeSingle();

      if (error) {
        // Table likely doesn't exist yet — let them in as member
        console.warn("[auth] Role lookup skipped:", error.message);
        setUserRole("member");
      } else if (row) {
        if (!row.active) {
          setAccessDenied(true);
          supabase.auth.signOut().catch(() => {});
          return;
        }
        setUserRole(row.role as UserRole);
        // Back-fill user_id if seeded row has none
        if (!row.user_id) {
          supabase.from(ROLES_TABLE).update({ user_id: user.id }).eq("id", row.id).then(() => {});
        }
      } else {
        // No row yet — auto-provision as member
        supabase.from(ROLES_TABLE).insert({
          user_id: user.id,
          email: user.email ?? "",
          role: "member",
          active: true,
        }).then(() => {});
        setUserRole("member");
      }

      // 3. Upsert into users table for @mentions
      supabase.from(USERS_TABLE).upsert({
        id: user.id,
        email: user.email ?? "",
        name: user.user_metadata?.full_name ?? user.email ?? "",
        avatar_url: user.user_metadata?.avatar_url ?? null,
        last_seen: new Date().toISOString(),
      }, { onConflict: "id" }).then(() => {});

    } catch (e) {
      console.warn("[auth] Background access check error (ignoring):", e);
      setUserRole("member"); // fail open
    }
  };

  // ── inactivity listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!fullyAuthed) {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      return;
    }
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [fullyAuthed, resetInactivityTimer]);

  // ── actions ───────────────────────────────────────────────────────────────
  const signInWithGoogle = useCallback(async () => {
    setOauthLoading(true);
    setOauthError(null);
    setAccessDenied(false);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { access_type: "offline", prompt: "select_account" },
      },
    });
    if (error) {
      setOauthError(error.message);
      setOauthLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    setGoogleUser(null);
    setUserRole(null);
    setAccessDenied(false);
    sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    await supabase.auth.signOut();
  }, []);

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
