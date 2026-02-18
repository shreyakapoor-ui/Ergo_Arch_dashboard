// =============================================================================
// MentionTextarea — reusable textarea with @mention autocomplete.
//
// Usage:
//   <MentionTextarea
//     value={text}
//     onChange={setText}
//     onMentionsChange={setMentionedUsers}
//     placeholder="Write something... type @ to mention someone"
//     className="..."
//   />
//
// Props:
//   value              — controlled text value
//   onChange           — called with new text (string)
//   onMentionsChange   — called with the current array of MentionedUser
//                        whenever the mention set changes
//   users              — optional pre-loaded user list (if omitted, the
//                        component fetches from Supabase itself)
//   initialMentions    — mentions already persisted (for edit scenarios)
//   className          — forwarded to the <textarea>
//   rows / placeholder — forwarded to the <textarea>
// =============================================================================

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  KeyboardEvent,
  ChangeEvent,
} from "react";
import { supabase } from "../supabaseClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MentionUser {
  id: string;        // Supabase auth UUID
  name: string;
  email: string;
  avatar_url?: string | null;
}

export interface MentionedUser {
  user_id: string;
  email: string;
  name: string;
}

interface MentionTextareaProps {
  value: string;
  onChange: (text: string) => void;
  onMentionsChange?: (mentions: MentionedUser[]) => void;
  users?: MentionUser[];           // optional — skip internal fetch if provided
  initialMentions?: MentionedUser[];
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}

// How many dropdown items to show at once
const MAX_SUGGESTIONS = 6;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  users: propUsers,
  initialMentions = [],
  placeholder,
  className = "",
  rows = 4,
  autoFocus = false,
  disabled = false,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── User list ─────────────────────────────────────────────────────────────
  const [allUsers, setAllUsers] = useState<MentionUser[]>(propUsers ?? []);

  useEffect(() => {
    if (propUsers) { setAllUsers(propUsers); return; }
    supabase
      .from("users")
      .select("id, name, email, avatar_url")
      .order("name")
      .then(({ data, error }) => {
        if (!error && data) setAllUsers(data as MentionUser[]);
      });
  }, [propUsers]);

  // ── Mention tracking ──────────────────────────────────────────────────────
  // Map of user_id → MentionedUser for currently-confirmed mentions in text
  const [mentionMap, setMentionMap] = useState<Map<string, MentionedUser>>(() => {
    const m = new Map<string, MentionedUser>();
    initialMentions.forEach(u => m.set(u.user_id, u));
    return m;
  });

  // Sync mention map when text changes: prune users whose @Name no longer appears
  useEffect(() => {
    setMentionMap(prev => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((u, id) => {
        // Simple check: the display name must still appear in the text
        if (!value.includes(`@${u.name}`)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [value]);

  // Notify parent whenever mention set changes
  useEffect(() => {
    onMentionsChange?.(Array.from(mentionMap.values()));
  }, [mentionMap, onMentionsChange]);

  // ── @-query state ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState<string | null>(null); // null = dropdown closed
  const [queryStart, setQueryStart] = useState(0);         // index of the '@' char
  const [highlightIdx, setHighlightIdx] = useState(0);

  const suggestions = query === null ? [] : allUsers
    .filter(u =>
      u.name.toLowerCase().includes(query.toLowerCase()) ||
      u.email.toLowerCase().includes(query.toLowerCase())
    )
    .slice(0, MAX_SUGGESTIONS);

  // ── Detect @-query from caret position ───────────────────────────────────
  const detectQuery = useCallback((text: string, caretPos: number) => {
    // Walk back from caret to find '@' on the same line with no spaces after it
    const before = text.slice(0, caretPos);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) { setQuery(null); return; }

    const between = before.slice(atIdx + 1); // text between '@' and caret
    // If there's a space or newline after '@', the mention is finished or invalid
    if (/[\s\n]/.test(between)) { setQuery(null); return; }

    setQuery(between);
    setQueryStart(atIdx);
    setHighlightIdx(0);
  }, []);

  // ── textarea change handler ───────────────────────────────────────────────
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    onChange(newText);
    detectQuery(newText, e.target.selectionStart ?? newText.length);
  };

  // ── Select a suggestion ───────────────────────────────────────────────────
  const selectSuggestion = useCallback((user: MentionUser) => {
    const before = value.slice(0, queryStart);      // up to and including '@'
    const after  = value.slice(textareaRef.current?.selectionStart ?? value.length);
    const insert = `@${user.name} `;
    const newText = before + insert + after;

    onChange(newText);
    setQuery(null);

    // Register confirmed mention
    setMentionMap(prev => {
      const next = new Map(prev);
      next.set(user.id, { user_id: user.id, email: user.email, name: user.name });
      return next;
    });

    // Restore focus + move caret to end of inserted text
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = before.length + insert.length;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [value, queryStart, onChange]);

  // ── Keyboard navigation for dropdown ─────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query === null || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx(i => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx(i => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIdx]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  };

  // ── Caret position on click/key ───────────────────────────────────────────
  const handleSelectionChange = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    detectQuery(ta.value, ta.selectionStart);
  };

  // ── Dropdown position ─────────────────────────────────────────────────────
  // We render the dropdown below the textarea. For a richer implementation
  // you'd compute pixel position from the caret, but the simple bottom-anchor
  // approach is sufficient here without a heavy dependency.
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (query === null) return;
    const handler = (e: MouseEvent) => {
      if (
        !textareaRef.current?.contains(e.target as Node) &&
        !dropdownRef.current?.contains(e.target as Node)
      ) {
        setQuery(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [query]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleSelectionChange}
        onKeyUp={handleSelectionChange}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        disabled={disabled}
        className={[
          // Match the existing Textarea component's base styles
          "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm",
          "shadow-sm placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 resize-y",
          className,
        ].join(" ")}
      />

      {/* ── @mention dropdown ── */}
      {query !== null && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-[200] left-0 mt-1 w-full max-w-xs bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          // position above if too close to bottom — simple heuristic
          style={{ top: "100%" }}
        >
          {suggestions.map((user, idx) => (
            <button
              key={user.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                selectSuggestion(user);
              }}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                idx === highlightIdx
                  ? "bg-blue-50 text-blue-900"
                  : "hover:bg-gray-50 text-gray-800",
              ].join(" ")}
            >
              {/* Avatar */}
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                  {user.name[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="min-w-0">
                <p className="font-medium truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-gray-400 truncate leading-tight">{user.email}</p>
              </div>
            </button>
          ))}

          {/* Hint */}
          <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50">
            <p className="text-[10px] text-gray-400">
              ↑↓ navigate · Enter/Tab select · Esc cancel
            </p>
          </div>
        </div>
      )}

      {/* Show "no results" only when user has typed something after @ */}
      {query !== null && query.length > 0 && suggestions.length === 0 && (
        <div className="absolute z-[200] left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow px-3 py-2 text-xs text-gray-400">
          No users match "{query}"
        </div>
      )}
    </div>
  );
}
