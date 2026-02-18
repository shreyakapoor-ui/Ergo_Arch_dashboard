// =============================================================================
// AUTH CONSTANTS — single source of truth for all auth configuration.
// Authentication is Google OAuth only (via Supabase Auth).
// =============================================================================

/**
 * Inactivity timeout in milliseconds.
 * Change this single constant to adjust the session lifetime.
 * Default: 30 minutes.
 */
export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

/** sessionStorage key for the last activity timestamp (ms epoch). */
export const SESSION_LAST_ACTIVITY_KEY = "arch-last-activity";

/** Supabase table where verified user profiles are stored for @mentions. */
export const USERS_TABLE = "users";

/** Supabase table where per-user roles are stored. */
export const ROLES_TABLE = "user_roles";

/**
 * Only users whose Google account email domain matches one of these values
 * are allowed into the app. All others see the "Access Restricted" screen.
 */
export const ALLOWED_DOMAINS = [
  "bluelabellabs.com",
  "ergo.net",
  "beyonddataconsulting.io",
] as const;

/** The two roles a user can hold. */
export type UserRole = "admin" | "member";
