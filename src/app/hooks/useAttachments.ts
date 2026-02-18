// =============================================================================
// useAttachments — manages file attachments for a single context
// (node + field combination).
//
// Responsibilities:
//   1. Fetch existing attachment metadata for this context from Supabase.
//   2. Upload new files to Supabase Storage bucket "attachments".
//   3. Store metadata in the public.attachments table.
//   4. Generate signed URLs for download/preview.
//   5. Delete attachments (storage object + DB row).
//
// Usage:
//   const { attachments, uploading, upload, remove, getSignedUrl } =
//     useAttachments({ contextType: "node", contextId: nodeId, field: "weekly_update", currentUser });
// =============================================================================

import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../supabaseClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Attachment {
  id: string;
  context_type: string;
  context_id: string;
  field: string;
  file_name: string;
  file_path: string;   // storage path inside the bucket
  mime_type: string;
  size_bytes: number;
  uploaded_by_user_id: string;
  created_at: string;
}

export type AttachmentField =
  | "weekly_update"
  | "comment"
  | "description"
  | "inputs"
  | "outputs"
  | "remaining_mvp_scope"
  | "blockers"
  | "future_scope";


interface UseAttachmentsOptions {
  contextType: "node";
  contextId: string;
  field: AttachmentField;
  currentUser: User | null;
}

interface UseAttachmentsReturn {
  attachments: Attachment[];
  uploading: boolean;
  /** Upload one or more files from a file input change event */
  upload: (files: FileList | File[]) => Promise<void>;
  /** Remove an attachment (storage + DB) */
  remove: (attachment: Attachment) => Promise<void>;
  /** Get a short-lived signed URL for viewing/downloading */
  getSignedUrl: (attachment: Attachment) => Promise<string | null>;
  loading: boolean;
}

const BUCKET = "attachments";
// Signed URL valid for 1 hour
const SIGNED_URL_EXPIRY_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttachments({
  contextType,
  contextId,
  field,
  currentUser,
}: UseAttachmentsOptions): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // ── Fetch existing attachments for this context+field on mount / id change
  useEffect(() => {
    if (!contextId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    supabase
      .from("attachments")
      .select("*")
      .eq("context_type", contextType)
      .eq("context_id", contextId)
      .eq("field", field)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) {
          setAttachments(data as Attachment[]);
        }
        setLoading(false);
      });
  }, [contextType, contextId, field]);

  // ── Upload files ──────────────────────────────────────────────────────────
  const upload = useCallback(
    async (files: FileList | File[]) => {
      if (!currentUser || !contextId) return;
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setUploading(true);

      await Promise.all(
        fileArray.map(async (file) => {
          // Build a unique storage path:  node/<nodeId>/<field>/<timestamp>-<fileName>
          const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `${contextType}/${contextId}/${field}/${Date.now()}-${safeFileName}`;

          // 1. Upload to Storage
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (uploadError) {
            console.error("[useAttachments] storage upload failed:", uploadError.message);
            return;
          }

          // 2. Insert metadata row
          const { data: row, error: insertError } = await supabase
            .from("attachments")
            .insert({
              context_type: contextType,
              context_id: contextId,
              field,
              file_name: file.name,
              file_path: storagePath,
              mime_type: file.type || "application/octet-stream",
              size_bytes: file.size,
              uploaded_by_user_id: currentUser.id,
            })
            .select()
            .single();

          if (insertError) {
            console.error("[useAttachments] DB insert failed:", insertError.message);
            // Attempt to clean up orphaned storage object
            await supabase.storage.from(BUCKET).remove([storagePath]);
            return;
          }

          if (row) {
            setAttachments((prev) => [...prev, row as Attachment]);
          }
        })
      );

      setUploading(false);
    },
    [contextType, contextId, field, currentUser]
  );

  // ── Remove attachment ─────────────────────────────────────────────────────
  const remove = useCallback(async (attachment: Attachment) => {
    // 1. Delete from storage
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([attachment.file_path]);

    if (storageError) {
      console.error("[useAttachments] storage delete failed:", storageError.message);
      // Continue anyway to keep UI and DB in sync
    }

    // 2. Delete metadata row
    const { error: dbError } = await supabase
      .from("attachments")
      .delete()
      .eq("id", attachment.id);

    if (dbError) {
      console.error("[useAttachments] DB delete failed:", dbError.message);
      return;
    }

    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
  }, []);

  // ── Get signed URL ────────────────────────────────────────────────────────
  const getSignedUrl = useCallback(async (attachment: Attachment): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(attachment.file_path, SIGNED_URL_EXPIRY_SECONDS);

    if (error) {
      console.error("[useAttachments] signed URL error:", error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  }, []);

  return { attachments, uploading, upload, remove, getSignedUrl, loading };
}
