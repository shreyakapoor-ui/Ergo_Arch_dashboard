// =============================================================================
// UnlockScreen — combined password gate + Google OAuth gate.
//
// Shown whenever the user is not fullyAuthed (either gate not yet passed, or
// the inactivity timer fired and the session was cleared).
//
// ⚠️  The shared password here is an ACCESS BARRIER, not identity.
//     Identity is established by Google OAuth only.
// =============================================================================

import { useState } from "react";
import { Lock, LogIn, CheckCircle, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import type { AuthActions, AuthState } from "../auth/useAuth";
import { INACTIVITY_TIMEOUT_MS } from "../auth/authConstants";

interface UnlockScreenProps
  extends Pick<
    AuthState & AuthActions,
    | "passwordPassed"
    | "googleUser"
    | "oauthLoading"
    | "oauthError"
    | "submitPassword"
    | "signInWithGoogle"
  > {
  /** Called once both gates are satisfied and user clicks "Enter app". */
  onEnter: () => void;
}

const TIMEOUT_MINUTES = Math.round(INACTIVITY_TIMEOUT_MS / 60_000);

export function UnlockScreen({
  passwordPassed,
  googleUser,
  oauthLoading,
  oauthError,
  submitPassword,
  signInWithGoogle,
  onEnter,
}: UnlockScreenProps) {
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState(false);

  const bothSatisfied = passwordPassed && googleUser !== null;

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = submitPassword(password);
    if (!ok) {
      setPwError(true);
      setPassword("");
      setTimeout(() => setPwError(false), 2500);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md space-y-8">

        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Ergo Architecture</h1>
          <p className="text-gray-500 text-sm mt-1">
            Complete both steps to access the dashboard
          </p>
        </div>

        {/* ── Step 1: shared password ────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StepBadge done={passwordPassed} n={1} />
            <span className="font-medium text-gray-800 text-sm">App password</span>
            {passwordPassed && (
              <CheckCircle className="h-4 w-4 text-green-500 ml-auto shrink-0" />
            )}
          </div>

          {!passwordPassed ? (
            <form onSubmit={handlePasswordSubmit} className="space-y-2 pl-7">
              <Input
                type="password"
                placeholder="Enter shared app password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={pwError ? "border-red-400 focus-visible:ring-red-400" : ""}
                autoFocus
              />
              {pwError && (
                <p className="text-red-500 text-xs">Incorrect password. Try again.</p>
              )}
              <Button type="submit" size="sm" className="w-full">
                Confirm password
              </Button>
            </form>
          ) : (
            <p className="text-green-600 text-xs pl-7">✓ Password accepted</p>
          )}
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white px-3 text-xs text-gray-400">then</span>
          </div>
        </div>

        {/* ── Step 2: Google OAuth ───────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <StepBadge done={googleUser !== null} n={2} />
            <span className="font-medium text-gray-800 text-sm">Sign in with Google</span>
            {googleUser && (
              <CheckCircle className="h-4 w-4 text-green-500 ml-auto shrink-0" />
            )}
          </div>

          <div className="pl-7 space-y-2">
            {googleUser ? (
              <div className="flex items-center gap-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                {googleUser.user_metadata?.avatar_url ? (
                  <img
                    src={googleUser.user_metadata.avatar_url}
                    alt="avatar"
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                    {(googleUser.user_metadata?.full_name ?? googleUser.email ?? "?")[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {googleUser.user_metadata?.full_name ?? "Signed in"}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{googleUser.email}</p>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={signInWithGoogle}
                disabled={oauthLoading}
              >
                {oauthLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GoogleIcon />
                )}
                {oauthLoading ? "Redirecting…" : "Sign in with Google"}
              </Button>
            )}

            {oauthError && (
              <p className="text-red-500 text-xs">{oauthError}</p>
            )}
          </div>
        </div>

        {/* ── Enter app button ──────────────────────────────────────── */}
        <Button
          className="w-full gap-2"
          size="lg"
          disabled={!bothSatisfied}
          onClick={onEnter}
        >
          <LogIn className="h-4 w-4" />
          Enter app
        </Button>

        {/* Footer */}
        <p className="text-xs text-gray-400 text-center">
          Sessions expire after {TIMEOUT_MINUTES} min of inactivity.
          Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold shrink-0 ${
        done
          ? "bg-green-500 text-white"
          : "bg-gray-200 text-gray-600"
      }`}
    >
      {n}
    </span>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
