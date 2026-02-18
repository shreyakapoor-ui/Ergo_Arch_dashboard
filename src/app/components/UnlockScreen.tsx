// =============================================================================
// UnlockScreen — Google OAuth sign-in screen.
//
// Shown whenever the user is not signed in (no valid Supabase session), or
// after the inactivity timer fires and clears the session.
// =============================================================================

import { useEffect } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import type { AuthActions, AuthState } from "../auth/useAuth";
import { INACTIVITY_TIMEOUT_MS } from "../auth/authConstants";

interface UnlockScreenProps
  extends Pick<
    AuthState & AuthActions,
    | "googleUser"
    | "oauthLoading"
    | "oauthError"
    | "signInWithGoogle"
  > {
  /** Called once the Google session is confirmed — enters the app. */
  onEnter: () => void;
}

const TIMEOUT_MINUTES = Math.round(INACTIVITY_TIMEOUT_MS / 60_000);

export function UnlockScreen({
  googleUser,
  oauthLoading,
  oauthError,
  signInWithGoogle,
  onEnter,
}: UnlockScreenProps) {
  // Auto-enter the app as soon as the OAuth redirect lands and googleUser is set
  useEffect(() => {
    if (googleUser) onEnter();
  }, [googleUser, onEnter]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <LogIn className="h-6 w-6 text-blue-600" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Ergo Architecture</h1>
          <p className="text-gray-500 text-sm mt-1">Sign in to access the dashboard</p>
        </div>

        {/* Sign-in area */}
        {googleUser ? (
          /* Already signed in (rare: flash before useEffect fires) */
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            {googleUser.user_metadata?.avatar_url ? (
              <img
                src={googleUser.user_metadata.avatar_url}
                alt="avatar"
                className="w-9 h-9 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold flex-shrink-0">
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
            size="lg"
            className="w-full gap-3"
            onClick={signInWithGoogle}
            disabled={oauthLoading}
          >
            {oauthLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GoogleIcon />
            )}
            {oauthLoading ? "Redirecting to Google…" : "Sign in with Google"}
          </Button>
        )}

        {oauthError && (
          <p className="text-red-500 text-xs text-center">{oauthError}</p>
        )}

        {/* Footer */}
        <p className="text-xs text-gray-400 text-center">
          Sessions expire after {TIMEOUT_MINUTES} min of inactivity.
        </p>
      </div>
    </div>
  );
}

// ── Google "G" icon ───────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" aria-hidden="true">
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
