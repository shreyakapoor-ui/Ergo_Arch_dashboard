// =============================================================================
// useAuth — Google OAuth gate with domain allowlist, role-based access,
//           and 30-min inactivity timeout.
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

// ---------------------------------------------------------------------------
// useAuth
// ---------------------------------------------------------------------------

export function useAuth(): AuthState & AuthActions {
  const [googleUser, setGoogleUser]     = useState<User | null>(null);
  const [loading, setLoading]           = useState(true);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthError, setOauthError]     = useState<string | null>(null);
  const [userRole, setUserRole]         = useState<UserRole | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Prevent resolveUserAccess from running concurrently for the same session
  const resolvingRef = useRef(false);

  const fullyAuthed = googleUser !== null && !accessDenied;

  // ── clearSession ──────────────────────────────────────────────────────────
  const clearSession = useCallback(async () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    setGoogleUser(null);
    setUserRole(null);
    setAccessDenied(false);
    sessionStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    await supabase.auth.signOut();
  }, []);

  // ── resetInactivityTimer ─────────────────────────────────────────────────
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    sessionStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(Date.now()));
    inactivityTimer.current = setTimeout(() => {
      console.log("[auth] Inactivity timeout — clearing session.");
      clearSession();
    }, INACTIVITY_TIMEOUT_MS);
  }, [clearSession]);

  // ── upsertUserRecord (for @mentions) ─────────────────────────────────────
  const upsertUserRecord = async (user: User) => {
    try {
      await supabase.from(USERS_TABLE).upsert(
        {
          id:         user.id,
          email:      user.email ?? "",
          name:       user.user_metadata?.full_name ?? user.email ?? "",
          avatar_url: user.user_metadata?.avatar_url ?? null,
          last_seen:  new Date().toISOString(),
        },
        { onConflict: "id" }
      );
    } catch {
      // Non-fatal — @mentions still work without this
    }
  };

  // ── resolveUserAccess ─────────────────────────────────────────────────────
  // Returns: 'allow' | 'deny'
  // Never throws — all errors are caught internally.
  const resolveUserAccess = async (user: User): Promise<'allow' | 'deny'> => {
    try {
      // 1. Domain check
      const emailDomain = (user.email ?? "").split("@")[1] ?? "";
      const domainAllowed = (ALLOWED_DOMAINS as readonly string[]).includes(emailDomain);

      if (!domainAllowed) {
        console.warn(`[auth] Domain '${emailDomain}' not in allowlist.`);
        return 'deny';
      }

      // 2. Role lookup — if table doesn't exist or RLS blocks, fail open as member
      try {
        const { data: roleRow, error: roleErr } = await supabase
          .from(ROLES_TABLE)
          .select("id, role, active, user_id")
          .eq("email", user.email ?? "")
          .maybeSingle();

        if (roleErr) {
          // Table may not exist yet (migration not run) — fail open
          console.warn("[auth] Role lookup failed (table may not exist yet):", roleErr.message);
          setUserRole("member");
          await upsertUserRecord(user);
          return 'allow';
        }

        if (roleRow) {
          if (!roleRow.active) {
            console.warn("[auth] User deactivated:", user.email);
            return 'deny';
          }
          setUserRole(roleRow.role as UserRole);

          // Back-fill user_id if seeded before first login
          if (!roleRow.user_id) {
            supabase
              .from(ROLES_TABLE)
              .update({ user_id: user.id })
              .eq("id", roleRow.id)
              .then(() => {/* fire and forget */});
          }
        } else {
          // No row — auto-provision as member
          supabase.from(ROLES_TABLE).insert({
            user_id: user.id,
            email:   user.email ?? "",
            role:    "member",
            active:  true,
          }).then(({ error }) => {
            if (error) console.warn("[auth] Could not create user_roles row:", error.message);
          });
          setUserRole("member");
        }
      } catch (roleEx) {
        // Any unexpected error in role lookup → fail open
        console.warn("[auth] Role resolution error (failing open):", roleEx);
        setUserRole("member");
      }

      await upsertUserRecord(user);
      return 'allow';
    } catch (ex) {
      // Absolute last resort — never block the user due to our own errors
      console.error("[auth] resolveUserAccess unexpected error (failing open):", ex);
      setUserRole("member");
      return 'allow';
    }
  };

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const handleUser = async (user: User | null) => {
      if (!user) {
        setGoogleUser(null);
        return;
      }

      // Prevent concurrent resolution (onAuthStateChange can fire before getSession resolves)
      if (resolvingRef.current) return;
      resolvingRef.current = true;

      try {
        const result = await resolveUserAccess(user);
        if (!mounted) return;

        if (result === 'deny') {
          setAccessDenied(true);
          setGoogleUser(null);
          // Sign out without triggering another resolve cycle
          supabase.auth.signOut().catch(() => {});
        } else {
          setGoogleUser(user);
        }
      } finally {
        resolvingRef.current = false;
      }
    };

    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      try {
        await handleUser(session?.user ?? null);
      } finally {
        if (mounted) setLoading(false);
      }
    });

    // Auth state changes (OAuth redirect, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: string, session: Session | null) => {
        if (!mounted) return;
        // Ignore SIGNED_OUT that we ourselves triggered (avoid re-entry)
        if (event === "SIGNED_OUT") {
          setGoogleUser(null);
          setLoading(false);
          setOauthLoading(false);
          return;
        }
        try {
          await handleUser(session?.user ?? null);
        } finally {
          if (mounted) {
            setOauthLoading(false);
            setLoading(false);
          }
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount — resolveUserAccess is defined in the same scope

  // ── Inactivity tracking ───────────────────────────────────────────────────
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
        queryParams: { access_type: "offline", prompt: "select_account" },
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
