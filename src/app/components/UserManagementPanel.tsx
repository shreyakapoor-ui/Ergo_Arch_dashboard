// =============================================================================
// UserManagementPanel — Admin-only panel for managing dashboard access.
//
// Shows every row in public.user_roles. Admins can:
//   • Toggle a user's `active` flag (revoke / restore access)
//   • Change a user's role between 'admin' and 'member'
//   • Add a new user by email (with an initial role)
//
// RLS on public.user_roles ensures only admins can read all rows and mutate.
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import { X, UserPlus, Loader2, RefreshCw, ShieldCheck, User } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { supabase } from "../supabaseClient";
import type { UserRole } from "../auth/authConstants";
import { ROLES_TABLE } from "../auth/authConstants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRoleRow {
  id: string;
  user_id: string | null;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
}

interface UserManagementPanelProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserManagementPanel({ onClose }: UserManagementPanelProps) {
  const [rows, setRows]           = useState<UserRoleRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [fetchError, setFetchError]   = useState<string | null>(null);

  // Add-user form state
  const [newEmail, setNewEmail]   = useState("");
  const [newRole, setNewRole]     = useState<UserRole>("member");
  const [adding, setAdding]       = useState(false);
  const [addError, setAddError]   = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState(false);

  // Per-row mutation loading
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  // ── Fetch all rows ─────────────────────────────────────────────────────────

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    setFetchError(null);
    const { data, error } = await supabase
      .from(ROLES_TABLE)
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      setFetchError(error.message);
    } else {
      setRows((data as UserRoleRow[]) ?? []);
    }
    setLoadingRows(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // ── Toggle active ──────────────────────────────────────────────────────────

  const toggleActive = async (row: UserRoleRow) => {
    setMutatingId(row.id);
    const { error } = await supabase
      .from(ROLES_TABLE)
      .update({ active: !row.active })
      .eq("id", row.id);

    if (!error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, active: !r.active } : r));
    } else {
      console.error("[UserManagement] toggleActive:", error.message);
    }
    setMutatingId(null);
  };

  // ── Change role ────────────────────────────────────────────────────────────

  const changeRole = async (row: UserRoleRow, newRoleValue: UserRole) => {
    setMutatingId(row.id);
    const { error } = await supabase
      .from(ROLES_TABLE)
      .update({ role: newRoleValue })
      .eq("id", row.id);

    if (!error) {
      setRows(prev => prev.map(r => r.id === row.id ? { ...r, role: newRoleValue } : r));
    } else {
      console.error("[UserManagement] changeRole:", error.message);
    }
    setMutatingId(null);
  };

  // ── Add new user ───────────────────────────────────────────────────────────

  const addUser = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) {
      setAddError("Enter a valid email address.");
      return;
    }

    setAdding(true);
    setAddError(null);
    setAddSuccess(false);

    const { error } = await supabase.from(ROLES_TABLE).insert({
      email:   trimmed,
      role:    newRole,
      active:  true,
    });

    if (error) {
      if (error.code === "23505") {
        setAddError("A row for this email already exists.");
      } else {
        setAddError(error.message);
      }
    } else {
      setAddSuccess(true);
      setNewEmail("");
      setNewRole("member");
      await fetchRows();
      setTimeout(() => setAddSuccess(false), 3000);
    }
    setAdding(false);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-gray-200 flex flex-col z-50">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">User Management</h2>
          <Badge variant="secondary" className="text-xs">{rows.length} users</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchRows}
            disabled={loadingRows}
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingRows ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* User list */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
        {loadingRows ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Loading users…</span>
          </div>
        ) : fetchError ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            Failed to load users: {fetchError}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No users found.</p>
        ) : (
          rows.map(row => (
            <UserRow
              key={row.id}
              row={row}
              mutating={mutatingId === row.id}
              onToggleActive={() => toggleActive(row)}
              onChangeRole={(r) => changeRole(row, r)}
            />
          ))
        )}
      </div>

      {/* Add user form */}
      <div className="flex-shrink-0 border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1">
          <UserPlus className="h-3.5 w-3.5" /> Add new user
        </p>

        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="user@company.com"
            value={newEmail}
            onChange={e => { setNewEmail(e.target.value); setAddError(null); }}
            className="flex-1 text-sm h-8"
            onKeyDown={e => { if (e.key === "Enter") addUser(); }}
          />
          {/* Role selector */}
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as UserRole)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <Button
          size="sm"
          className="w-full"
          onClick={addUser}
          disabled={adding || !newEmail.trim()}
        >
          {adding ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Adding…</>
          ) : (
            <><UserPlus className="h-3.5 w-3.5 mr-1" /> Add User</>
          )}
        </Button>

        {addError   && <p className="text-xs text-red-500">{addError}</p>}
        {addSuccess && <p className="text-xs text-green-600">User added successfully.</p>}

        <p className="text-xs text-gray-400">
          The user_id column is back-filled automatically on the user's first login.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserRow — a single row in the user list
// ---------------------------------------------------------------------------

interface UserRowProps {
  row: UserRoleRow;
  mutating: boolean;
  onToggleActive: () => void;
  onChangeRole: (role: UserRole) => void;
}

function UserRow({ row, mutating, onToggleActive, onChangeRole }: UserRowProps) {
  const initials = (row.email[0] ?? "?").toUpperCase();

  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-xl border text-sm transition-opacity ${
        row.active ? "bg-white border-gray-100" : "bg-gray-50 border-gray-100 opacity-60"
      }`}
    >
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs flex-shrink-0">
        {initials}
      </div>

      {/* Email + status */}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-900 truncate">{row.email}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {row.user_id ? (
            <span className="text-xs text-gray-400">Logged in before</span>
          ) : (
            <span className="text-xs text-amber-500">Never logged in</span>
          )}
          {!row.active && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Revoked</Badge>
          )}
        </div>
      </div>

      {/* Role selector */}
      <select
        value={row.role}
        onChange={e => onChangeRole(e.target.value as UserRole)}
        disabled={mutating}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>

      {/* Role badge icon */}
      {row.role === "admin" ? (
        <ShieldCheck className="h-4 w-4 text-blue-500 flex-shrink-0" />
      ) : (
        <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
      )}

      {/* Active toggle */}
      <Button
        variant={row.active ? "outline" : "secondary"}
        size="sm"
        className="h-7 text-xs px-2 flex-shrink-0"
        onClick={onToggleActive}
        disabled={mutating}
      >
        {mutating ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : row.active ? (
          "Revoke"
        ) : (
          "Restore"
        )}
      </Button>
    </div>
  );
}
