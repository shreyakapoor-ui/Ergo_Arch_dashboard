// =============================================================================
// AUTH CONSTANTS — single source of truth for all auth configuration.
//
// ⚠️  SECURITY NOTE — PASSWORD GATE IS NOT IDENTITY
// The shared app password is a lightweight access barrier only. It does NOT
// authenticate individual users and confers no identity. Real identity is
// established exclusively through Google OAuth (Supabase Auth). This
// architecture is intentional for the MVP. To harden later:
//   1. Move the password check to a Supabase Edge Function or your own API.
//   2. Issue a short-lived signed token on success instead of a sessionStorage flag.
//   3. Validate that token server-side before every write.
// =============================================================================

/**
 * Shared app password.
 *
 * ⚠️  Client-side only — not a secret in the cryptographic sense. Anyone who
 * can read the JS bundle can find this value. It is an access barrier, not
 * a security guarantee. Move server-side before making this app public.
 */
export const APP_PASSWORD = "ergo2026!Arch#Secure";

/**
 * Inactivity timeout in milliseconds.
 * Change this single constant to adjust the session lifetime.
 * Default: 30 minutes.
 */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** sessionStorage key that records the password gate being passed. */
export const SESSION_PW_KEY = "arch-pw-passed";

/** sessionStorage key for the last activity timestamp (ms epoch). */
export const SESSION_LAST_ACTIVITY_KEY = "arch-last-activity";

/** Supabase table where verified user profiles are stored for @mentions. */
export const USERS_TABLE = "users";
