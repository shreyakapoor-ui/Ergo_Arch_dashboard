// =============================================================================
// useMentions — manages the full mention lifecycle for a single context
// (node + field combination).
//
// Responsibilities:
//   1. Fetch the previously persisted mentions for this context from Supabase,
//      so the component can pre-seed the MentionTextarea.
//   2. On save: diff previous vs current mentioned user IDs → derive net-new.
//   3. Persist all current mentions to the `mentions` table (upsert).
//   4. Fire the `notify-mentions` Edge Function for the net-new subset only,
//      so already-notified users are never emailed again.
//
// Usage:
//   const { previousMentions, saveMentions } = useMentions({
//     contextType: "node",
//     contextId: nodeId,
//     field: "comment",
//     currentUser,
//   });
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";
import type { MentionedUser } from "../components/MentionTextarea";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MentionField =
  | "comment"
  | "weekly_update"
  | "description"
  | "blockers"
  | "remaining_mvp_scope";

interface UseMentionsOptions {
  contextType: "node";
  contextId: string;
  field: MentionField;
  /** The currently signed-in Google user. */
  currentUser: User | null;
  /** App URL used to build the deep-link in notification emails. */
  appUrl?: string;
  /** Name of the node (used in email subject). */
  nodeName?: string;
}

interface SaveMentionsOptions {
  currentMentions: MentionedUser[];
  /** Human-readable label for the email (e.g. the comment text snippet). */
  contextLabel?: string;
}

interface UseMentionsReturn {
  /** Mentions that were already persisted when the hook mounted. */
  previousMentions: MentionedUser[];
  /** Call this after a save to persist + notify. Returns net-new count. */
  saveMentions: (opts: SaveMentionsOptions) => Promise<number>;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMentions({
  contextType,
  contextId,
  field,
  currentUser,
  appUrl = window.location.origin,
  nodeName = "a node",
}: UseMentionsOptions): UseMentionsReturn {
  const [previousMentions, setPreviousMentions] = useState<MentionedUser[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Fetch existing mentions for this context+field on mount / contextId change
  useEffect(() => {
    if (!contextId) { setLoading(false); return; }
    setLoading(true);

    supabase
      .from("mentions")
      .select("mentioned_user_id, mentioned_email, mentioned_name")
      .eq("context_type", contextType)
      .eq("context_id", contextId)
      .eq("field", field)
      .then(({ data, error }) => {
        if (!error && data) {
          setPreviousMentions(
            data.map(r => ({
              user_id: r.mentioned_user_id as string,
              email: r.mentioned_email as string,
              name: r.mentioned_name as string,
            }))
          );
        }
        setLoading(false);
      });
  }, [contextType, contextId, field]);

  // ── Save + notify ──────────────────────────────────────────────────────────
  const saveMentions = useCallback(
    async ({ currentMentions, contextLabel }: SaveMentionsOptions): Promise<number> => {
      if (!contextId || !currentUser) return 0;

      // 1. Compute net-new mentions (not in previousMentions)
      const prevIds = new Set(previousMentions.map(m => m.user_id));
      const netNew = currentMentions.filter(m => !prevIds.has(m.user_id));

      // 2. Upsert all current mentions to the `mentions` table.
      //    We upsert every time (idempotent) so the table stays in sync.
      if (currentMentions.length > 0) {
        const rows = currentMentions.map(m => ({
          context_type: contextType,
          context_id: contextId,
          field,
          mentioned_user_id: m.user_id,
          mentioned_email: m.email,
          mentioned_name: m.name,
          created_by_user_id: currentUser.id,
        }));

        const { error: upsertErr } = await supabase
          .from("mentions")
          .upsert(rows, {
            onConflict: "context_type,context_id,field,mentioned_user_id",
            ignoreDuplicates: true,   // don't update timestamp on re-save
          });

        if (upsertErr) {
          console.error("[useMentions] upsert failed:", upsertErr.message);
        }
      }

      // 3. Notify net-new mentions via Edge Function
      if (netNew.length > 0) {
        const deepLink = `${appUrl}?node=${encodeURIComponent(contextId)}`;

        try {
          const { error: fnErr } = await supabase.functions.invoke("notify-mentions", {
            body: {
              mentions: netNew.map(m => ({
                user_id: m.user_id,
                email: m.email,
                name: m.name,
              })),
              mentioner: {
                name: currentUser.user_metadata?.full_name ?? currentUser.email ?? "A teammate",
                email: currentUser.email ?? "",
              },
              context: {
                node_id: contextId,
                node_name: nodeName,
                field,
                label: contextLabel ?? "",
                deep_link: deepLink,
              },
            },
          });

          if (fnErr) {
            console.error("[useMentions] notify-mentions fn error:", fnErr.message);
          }
        } catch (e) {
          // Non-fatal — email failure must not break the save flow
          console.error("[useMentions] notify-mentions threw:", e);
        }
      }

      // 4. Update local previous state so re-saves don't re-notify
      setPreviousMentions(currentMentions);

      return netNew.length;
    },
    [contextType, contextId, field, currentUser, previousMentions, appUrl, nodeName]
  );

  return { previousMentions, saveMentions, loading };
}
