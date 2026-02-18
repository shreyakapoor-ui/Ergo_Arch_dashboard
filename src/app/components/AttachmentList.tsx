// =============================================================================
// AttachmentList — renders a list of file attachments for a node field.
//
// Usage:
//   <AttachmentList
//     contextType="node"
//     contextId={node.id}
//     field="weekly_update"
//     currentUser={googleUser}
//   />
//
// Features:
//   - "Attach" button opens a hidden file input (multiple files allowed)
//   - Upload progress indicator
//   - List of attachments with file name, size, and delete button
//   - Clicking an attachment name: generates a signed URL and opens a modal
//     - PDF / image: inline preview
//     - Anything else: download/open link
// =============================================================================

import { useRef, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { Paperclip, Loader2, X, Download, FileText, Image as ImageIcon, File } from "lucide-react";
import { Button } from "./ui/button";
import { useAttachments, type Attachment, type AttachmentField } from "../hooks/useAttachments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttachmentListProps {
  contextType: "node";
  contextId: string;
  field: AttachmentField;
  currentUser: User | null;
  /** If true, hides the "Attach" button (read-only mode) */
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

function FileIcon({ mimeType, className = "h-4 w-4" }: { mimeType: string; className?: string }) {
  if (isImage(mimeType)) return <ImageIcon className={className} />;
  if (isPdf(mimeType)) return <FileText className={className} />;
  return <File className={className} />;
}

// ---------------------------------------------------------------------------
// Preview Modal
// ---------------------------------------------------------------------------

interface PreviewModalProps {
  attachment: Attachment;
  signedUrl: string;
  onClose: () => void;
}

function PreviewModal({ attachment, signedUrl, onClose }: PreviewModalProps) {
  const canPreview = isImage(attachment.mime_type) || isPdf(attachment.mime_type);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon mimeType={attachment.mime_type} className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-800 truncate">{attachment.file_name}</span>
            <span className="text-xs text-gray-400 flex-shrink-0">({formatBytes(attachment.size_bytes)})</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a
              href={signedUrl}
              download={attachment.file_name}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
            <button
              onClick={onClose}
              className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-50">
          {canPreview ? (
            isImage(attachment.mime_type) ? (
              <img
                src={signedUrl}
                alt={attachment.file_name}
                className="max-w-full max-h-full object-contain rounded"
              />
            ) : (
              // PDF
              <iframe
                src={signedUrl}
                title={attachment.file_name}
                className="w-full rounded"
                style={{ height: "70vh" }}
              />
            )
          ) : (
            <div className="text-center py-10 space-y-3">
              <FileIcon mimeType={attachment.mime_type} className="h-12 w-12 text-gray-300 mx-auto" />
              <p className="text-sm text-gray-500">Preview not available for this file type.</p>
              <a
                href={signedUrl}
                download={attachment.file_name}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Download className="h-4 w-4" />
                Download file
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AttachmentList({
  contextType,
  contextId,
  field,
  currentUser,
  readOnly = false,
}: AttachmentListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { attachments, uploading, upload, remove, getSignedUrl, loading } = useAttachments({
    contextType,
    contextId,
    field,
    currentUser,
  });

  // Preview modal state
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        await upload(files);
      }
      // Reset the input so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [upload]
  );

  const handleAttachmentClick = useCallback(
    async (attachment: Attachment) => {
      setPreviewLoading(true);
      const url = await getSignedUrl(attachment);
      if (url) {
        setPreviewAttachment(attachment);
        setPreviewUrl(url);
      }
      setPreviewLoading(false);
    },
    [getSignedUrl]
  );

  const handleRemove = useCallback(
    async (e: React.MouseEvent, attachment: Attachment) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${attachment.file_name}"?`)) return;
      await remove(attachment);
    },
    [remove]
  );

  if (loading) return null; // Silent while loading so it doesn't flash
  if (attachments.length === 0 && readOnly) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Attachment rows */}
      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((att) => (
            <li
              key={att.id}
              className="flex items-center gap-2 group/att rounded-md px-2 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <FileIcon
                mimeType={att.mime_type}
                className="h-3.5 w-3.5 text-gray-400 flex-shrink-0"
              />
              <button
                type="button"
                onClick={() => handleAttachmentClick(att)}
                className="flex-1 min-w-0 text-left"
                disabled={previewLoading}
              >
                <span className="text-xs text-blue-600 hover:text-blue-800 hover:underline truncate block">
                  {att.file_name}
                </span>
                <span className="text-[10px] text-gray-400">{formatBytes(att.size_bytes)}</span>
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, att)}
                  className="opacity-0 group-hover/att:opacity-100 h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                  title="Delete attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload button */}
      {!readOnly && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            // Accept common types but don't restrict (user can pick anything)
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-gray-500 hover:text-gray-800 px-2 gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !currentUser}
            title={!currentUser ? "Sign in to attach files" : undefined}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5" />
                Attach
              </>
            )}
          </Button>
        </>
      )}

      {/* Preview modal */}
      {previewAttachment && previewUrl && (
        <PreviewModal
          attachment={previewAttachment}
          signedUrl={previewUrl}
          onClose={() => {
            setPreviewAttachment(null);
            setPreviewUrl(null);
          }}
        />
      )}
    </div>
  );
}
