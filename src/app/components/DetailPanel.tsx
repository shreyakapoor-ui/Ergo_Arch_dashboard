import { ComponentNode, Tag, Comment, WeeklyUpdate } from '../types/architecture';
import { X, Plus, Send, Edit2, Check, Trash2, RefreshCw, Rocket, Lightbulb, MessageSquare, ChevronDown, ChevronRight, Calendar, AlertTriangle, Target } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { useState, useEffect, useRef, useCallback } from 'react';
import { format } from 'date-fns';
import type { User } from '@supabase/supabase-js';
import { MentionTextarea, type MentionedUser } from './MentionTextarea';
import { useMentions } from '../hooks/useMentions';
import { AttachmentList } from './AttachmentList';

type PanelTab = 'mvp' | 'future' | 'discussion';

interface DetailPanelProps {
  node: ComponentNode | null;
  tags: Tag[];
  /** Signed-in Google user — needed to attribute mentions. */
  googleUser?: User | null;
  allTags: Tag[];
  onClose: () => void;
  onUpdateNode: (nodeId: string, updates: Partial<ComponentNode>) => void;
  onDeleteNode: (nodeId: string) => void;
  onCreateTag: (label: string, color: string) => void;
  onEditStart?: (nodeId: string) => void;
  onEditEnd?: (nodeId?: string) => void;
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}

// ─── Collapsible Section ────────────────────────────────────────────
function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
  badge,
  tint,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
  tint?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`border rounded-lg ${tint || 'border-gray-200'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors rounded-t-lg ${!open ? 'rounded-b-lg' : ''}`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />}
        {icon}
        <span className="uppercase tracking-wider flex-1">{title}</span>
        {badge}
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-gray-100">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── URL Detection ───────────────────────────────────────────────────
// Matches http(s):// URLs and bare www. URLs.
const URL_REGEX = /((https?:\/\/|www\.)[^\s<>"')\]]+)/g;

/** Splits a plain-text segment into text nodes and <a> link nodes. */
function renderWithLinks(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0; // reset stateful regex
  while ((match = URL_REGEX.exec(text)) !== null) {
    const [fullMatch] = match;
    const start = match.index;

    // Text before this URL
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    // Normalise: prepend https:// to bare www. links
    const href = fullMatch.startsWith('http') ? fullMatch : `https://${fullMatch}`;

    parts.push(
      <a
        key={start}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800 break-all"
        onClick={(e) => e.stopPropagation()}
      >
        {fullMatch}
      </a>
    );

    lastIndex = start + fullMatch.length;
  }

  // Remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

// ─── Formatted Text Renderer ────────────────────────────────────────
function FormattedText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null;
  const lines = text.split('\n');

  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      {lines.map((line, i) => {
        const trimmedLine = line.trim();
        if (!trimmedLine) return <div key={i} className="h-1.5" />;
        if (/^[-*•]\s/.test(trimmedLine)) {
          return (
            <div key={i} className="flex gap-1.5 ml-1">
              <span className="text-gray-400 text-xs mt-0.5">•</span>
              <span className="text-gray-700">{renderWithLinks(trimmedLine.replace(/^[-*•]\s*/, ''))}</span>
            </div>
          );
        }
        const numberedMatch = trimmedLine.match(/^(\d+)[.)]\s*(.*)/);
        if (numberedMatch) {
          return (
            <div key={i} className="flex gap-1.5 ml-1">
              <span className="text-gray-400 min-w-[1.2rem] text-xs mt-0.5">{numberedMatch[1]}.</span>
              <span className="text-gray-700">{renderWithLinks(numberedMatch[2])}</span>
            </div>
          );
        }
        return <p key={i} className="text-gray-700">{renderWithLinks(line)}</p>;
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────
function generateId() {
  return `wu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDateLabel(isoDate: string) {
  try {
    const d = new Date(isoDate + 'T12:00:00');
    return format(d, 'EEEE, MMM d, yyyy');
  } catch {
    return isoDate;
  }
}

/**
 * Migrate legacy workDone + inDevelopment into a seed weeklyUpdates entry.
 * Only runs once per node that has legacy data but no weeklyUpdates yet.
 */
function migrateWeeklyUpdates(node: ComponentNode): WeeklyUpdate[] {
  if (node.weeklyUpdates && node.weeklyUpdates.length > 0) return node.weeklyUpdates;

  const parts: string[] = [];
  if (node.workDone && node.workDone.trim()) {
    parts.push('## Work Done\n' + node.workDone.trim());
  }
  if (node.inDevelopment && node.inDevelopment.trim()) {
    parts.push('## In Development\n' + node.inDevelopment.trim());
  }
  if (parts.length === 0) return [];

  return [{
    id: generateId(),
    date: '2026-02-12',
    text: parts.join('\n\n'),
  }];
}

// ─── Main Component ─────────────────────────────────────────────────
export function DetailPanel({ node, tags, allTags, onClose, onUpdateNode, onDeleteNode, onCreateTag, onEditStart, onEditEnd, width = 500, onResizeStart, isResizing = false, googleUser = null }: DetailPanelProps) {
  // ── Shared state ──
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [newComment, setNewComment] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  // Mentions tracked inside the new-comment textarea
  const [newCommentMentions, setNewCommentMentions] = useState<MentionedUser[]>([]);
  // Mentions tracked inside the currently-editing weekly update textarea
  const [editingUpdateMentions, setEditingUpdateMentions] = useState<MentionedUser[]>([]);
  const [showTagCreator, setShowTagCreator] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('mvp');

  // ── Inline edit state ──
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // ── Future Scope ──
  const [futureScopeDraft, setFutureScopeDraft] = useState('');
  const [futureScopeDirty, setFutureScopeDirty] = useState(false);
  const [futureScopeSaveState, setFutureScopeSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // ── Weekly Updates local state ──
  const [localUpdates, setLocalUpdates] = useState<WeeklyUpdate[]>([]);
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editingUpdateText, setEditingUpdateText] = useState('');
  const [editingUpdateDate, setEditingUpdateDate] = useState('');
  const [updatesMigrated, setUpdatesMigrated] = useState(false);

  // ── Remaining MVP / Blockers local drafts ──
  const [remainingDraft, setRemainingDraft] = useState('');
  const [remainingDirty, setRemainingDirty] = useState(false);
  const [blockersDraft, setBlockersDraft] = useState('');
  const [blockersDirty, setBlockersDirty] = useState(false);

  const prevNodeIdRef = useRef<string | null>(null);
  const newUpdateRef = useRef<HTMLDivElement | null>(null);
  // No client-side debounce — App.tsx auto-save effect handles debouncing to Supabase

  // ── Reset state when node changes ──
  useEffect(() => {
    if (node && node.id !== prevNodeIdRef.current) {
      setActiveTab('mvp');
      setFutureScopeDraft(node.futureScope || '');
      setFutureScopeDirty(false);
      setFutureScopeSaveState('idle');
      setEditingField(null);
      setEditValue('');
      setSaveState('idle');
      setEditingUpdateId(null);
      setShowTagCreator(false);

      // Migrate and set weekly updates
      const migrated = migrateWeeklyUpdates(node);
      setLocalUpdates(migrated);
      setUpdatesMigrated(false);

      // If there were legacy fields to migrate, persist once
      if (migrated.length > 0 && (!node.weeklyUpdates || node.weeklyUpdates.length === 0)) {
        onEditStart?.(node.id);
        onUpdateNode(node.id, { weeklyUpdates: migrated });
        setUpdatesMigrated(true);
        // Clear dirty after save debounce + network round-trip
        setTimeout(() => onEditEnd?.(node.id), 3000);
      } else {
        setUpdatesMigrated(true);
      }

      setRemainingDraft(node.remainingMvpScope || '');
      setRemainingDirty(false);
      setBlockersDraft(node.blockers || node.blocker || '');
      setBlockersDirty(false);

      prevNodeIdRef.current = node.id;
    }
  }, [node?.id]);

  // Keep future scope in sync from remote (if not dirty)
  useEffect(() => {
    if (node && !futureScopeDirty) {
      setFutureScopeDraft(node.futureScope || '');
    }
  }, [node?.futureScope, futureScopeDirty]);

  // Keep weekly updates in sync from remote (if not editing)
  useEffect(() => {
    if (node && node.weeklyUpdates && node.weeklyUpdates.length > 0 && !editingUpdateId) {
      setLocalUpdates(node.weeklyUpdates);
    }
  }, [node?.weeklyUpdates, editingUpdateId]);

  // Keep remaining + blockers in sync from remote (if not dirty)
  useEffect(() => {
    if (node && !remainingDirty) setRemainingDraft(node.remainingMvpScope || '');
  }, [node?.remainingMvpScope, remainingDirty]);

  useEffect(() => {
    if (node && !blockersDirty) setBlockersDraft(node.blockers || node.blocker || '');
  }, [node?.blockers, node?.blocker, blockersDirty]);

  // Cleanup edit lock on unmount / node change
  useEffect(() => {
    const currentNodeId = node?.id;
    return () => { if (currentNodeId) onEditEnd?.(currentNodeId); };
  }, [node?.id, onEditEnd]);

  // ── useMentions for the comment field ─────────────────────────────────────
  // Each comment gets its own mention context keyed by comment id at save time.
  // We use the node id + "comment" as a stable context for the *new* comment.
  const { saveMentions: saveCommentMentions } = useMentions({
    contextType: "node",
    contextId: node?.id ?? "",
    field: "comment",
    currentUser: googleUser,
    nodeName: node?.name,
  });

  // ── useMentions for weekly update field ────────────────────────────────────
  const { saveMentions: saveUpdateMentions } = useMentions({
    contextType: "node",
    contextId: node?.id ?? "",
    field: "weekly_update",
    currentUser: googleUser,
    nodeName: node?.name,
  });

  if (!node) return null;

  const nodeTags = tags.filter((t) => node.tags.includes(t.id));

  // ── Protected update: marks node dirty during save window to prevent remote overwrite ──
  const protectedUpdate = (nodeId: string, updates: Partial<ComponentNode>) => {
    onEditStart?.(nodeId);
    onUpdateNode(nodeId, updates);
    // Clear dirty after save debounce (800ms) + network round-trip buffer
    setTimeout(() => onEditEnd?.(nodeId), 3000);
  };

  // ── Tag handlers ──
  const handleAddTag = (tagId: string) => {
    if (!node.tags.includes(tagId)) protectedUpdate(node.id, { tags: [...node.tags, tagId] });
  };
  const handleRemoveTag = (tagId: string) => {
    protectedUpdate(node.id, { tags: node.tags.filter((t) => t !== tagId) });
  };
  const handleCreateTag = () => {
    if (newTagLabel.trim()) {
      onCreateTag(newTagLabel.trim(), newTagColor);
      setNewTagLabel('');
      setShowTagCreator(false);
    }
  };

  // ── Comment handlers ──
  const extractMentions = (text: string): string[] => {
    const matches = text.match(/@(\w+)/g);
    return matches ? matches.map((m) => m.substring(1)) : [];
  };
  const handleAddComment = () => {
    if (newComment.trim() && commentAuthor.trim()) {
      const comment: Comment = {
        id: `c-${Date.now()}`,
        text: newComment,
        author: commentAuthor,
        timestamp: new Date(),
        // Merge structured mention names with any legacy @word matches
        mentions: newCommentMentions.length > 0
          ? newCommentMentions.map(m => m.name)
          : extractMentions(newComment),
        status: 'open',
      };
      protectedUpdate(node.id, { comments: [...node.comments, comment] });

      // Persist mentions + fire email notifications for net-new mentions
      saveCommentMentions({
        currentMentions: newCommentMentions,
        contextLabel: newComment.slice(0, 120),
      });

      setNewComment('');
      setNewCommentMentions([]);
    }
  };
  const handleUpdateCommentStatus = (commentId: string, status: Comment['status']) => {
    const updatedComments = node.comments.map((c) => c.id === commentId ? { ...c, status } : c);
    protectedUpdate(node.id, { comments: updatedComments });
  };
  const handleDeleteComment = (commentId: string) => {
    protectedUpdate(node.id, { comments: node.comments.filter((c) => c.id !== commentId) });
  };

  // ── Weekly Update handlers ──
  const handleAddWeeklyUpdate = () => {
    const newEntry: WeeklyUpdate = { id: generateId(), date: todayISO(), text: '' };
    const updated = [newEntry, ...localUpdates];
    setLocalUpdates(updated);
    setEditingUpdateId(newEntry.id);
    setEditingUpdateText('');
    setEditingUpdateDate(newEntry.date);
    setTimeout(() => newUpdateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  };

  const handleSaveWeeklyUpdate = (updateId: string) => {
    const updated = localUpdates.map((u) =>
      u.id === updateId ? { ...u, text: editingUpdateText, date: editingUpdateDate } : u
    );
    setLocalUpdates(updated);
    setEditingUpdateId(null);
    onEditStart?.(node.id);
    onUpdateNode(node.id, { weeklyUpdates: updated });
    setTimeout(() => onEditEnd?.(node.id), 3000);

    // Persist + notify mentions in this weekly update
    saveUpdateMentions({
      currentMentions: editingUpdateMentions,
      contextLabel: editingUpdateText.slice(0, 120),
    });
    setEditingUpdateMentions([]);
  };

  const handleDeleteWeeklyUpdate = (updateId: string) => {
    if (!window.confirm('Delete this weekly update?')) return;
    const updated = localUpdates.filter((u) => u.id !== updateId);
    setLocalUpdates(updated);
    onEditStart?.(node.id);
    onUpdateNode(node.id, { weeklyUpdates: updated });
    setTimeout(() => onEditEnd?.(node.id), 3000);
  };

  // ── Future Scope save ──
  const handleSaveFutureScope = () => {
    setFutureScopeSaveState('saving');
    onEditStart?.(node.id);
    onUpdateNode(node.id, { futureScope: futureScopeDraft });
    setFutureScopeSaveState('saved');
    setFutureScopeDirty(false);
    setTimeout(() => { setFutureScopeSaveState('idle'); onEditEnd?.(node.id); }, 1500);
  };

  // ── Status helpers ──
  const getStatusBadgeColor = () => {
    switch (node.status) {
      case 'built': return 'bg-green-500';
      case 'in-progress': return 'bg-yellow-500';
      case 'planned': return 'bg-gray-400';
      case 'open-question': return 'bg-red-500';
    }
  };
  const getStatusLabel = () => {
    switch (node.status) {
      case 'built': return 'Built';
      case 'in-progress': return 'In Progress';
      case 'planned': return 'Planned';
      case 'open-question': return 'Open Question';
    }
  };

  // ── Inline edit helpers ──
  const startEdit = (field: string, currentValue: string | string[]) => {
    onEditStart?.(node.id);
    setEditingField(field);
    setEditValue(Array.isArray(currentValue) ? currentValue.join('\n') : currentValue);
  };

  const saveEdit = (field: string) => {
    setSaveState('saving');
    const updates = field === 'inputs' || field === 'outputs'
      ? { [field]: editValue.split('\n').filter((line: string) => line.trim()) }
      : { [field]: editValue };
    onUpdateNode(node.id, updates);
    setSaveState('saved');
    setTimeout(() => { setSaveState('idle'); setEditingField(null); setEditValue(''); onEditEnd?.(node.id); }, 1000);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
    setSaveState('idle');
    onEditEnd?.(node.id);
  };

  // ── Save Button ──
  const SaveButton = ({ onClick, currentSaveState }: { onClick: () => void; currentSaveState?: 'idle' | 'saving' | 'saved' | 'error' }) => {
    const state = currentSaveState ?? saveState;
    return (
      <Button size="sm" onClick={onClick} disabled={state === 'saving'} className="transition-all duration-150 hover:shadow-md active:scale-[0.98]">
        {state === 'saving' ? (<><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Saving…</>) :
         state === 'saved' ? (<><Check className="h-3 w-3 mr-1 text-green-500" />Saved ✓</>) :
         (<><Check className="h-3 w-3 mr-1" />Save</>)}
      </Button>
    );
  };

  // ── Tab definitions ──
  const tabs: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'mvp', label: 'MVP Scope (Q1)', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'future', label: 'Future Scope', icon: <Lightbulb className="h-3.5 w-3.5" /> },
    { id: 'discussion', label: 'Discussion', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  ];

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <div
      className="fixed right-0 top-0 h-screen flex flex-col border-l bg-white shadow-2xl z-50"
      style={{ width: `${width}px`, userSelect: isResizing ? 'none' : undefined }}
    >
      {/* Resize Handle */}
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-[60] group"
          style={{ transform: 'translateX(-50%)' }}
        >
          <div className={`h-full w-0.5 mx-auto transition-colors duration-150 ${isResizing ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-400'}`} />
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* ── STICKY HEADER ── */}
      <div className="flex-shrink-0 bg-white border-b z-10">
        <div className="px-5 pt-4 pb-0">
          {/* Title row */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              {editingField === 'name' ? (
                <div className="space-y-2 mb-1">
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Node name" className="text-lg font-semibold" />
                  <div className="flex gap-2">
                    <SaveButton onClick={() => saveEdit('name')} />
                    <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 mb-1 group/title">
                  <h2 className="text-lg font-semibold text-gray-900 truncate">{node.name}</h2>
                  <Button variant="ghost" size="sm" onClick={() => startEdit('name', node.name)} className="h-6 px-1.5 opacity-0 group-hover/title:opacity-100 transition-opacity">
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Badge className={`${getStatusBadgeColor()} text-white text-[10px] px-2 py-0.5`}>{getStatusLabel()}</Badge>
                {editingField !== 'status' && (
                  <Button variant="ghost" size="sm" onClick={() => startEdit('status', node.status)} className="h-5 px-1.5 opacity-60 hover:opacity-100">
                    <Edit2 className="h-2.5 w-2.5" />
                  </Button>
                )}
              </div>
              {editingField === 'status' && (
                <div className="mt-2 space-y-2">
                  <Select value={editValue} onValueChange={(value) => setEditValue(value)}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="built">Built</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="open-question">Open Question</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <SaveButton onClick={() => saveEdit('status')} />
                    <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="flex-shrink-0 -mt-1 -mr-1">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Segmented Tab Control */}
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1 mb-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-all duration-150 ${
                  activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                <span className="truncate">{tab.label}</span>
                {tab.id === 'discussion' && node.comments.length > 0 && (
                  <span className={`ml-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold ${
                    activeTab === 'discussion' ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-600'
                  }`}>{node.comments.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* ═══════ TAB: MVP Scope (Q1) ═══════ */}
        {activeTab === 'mvp' && (
          <div className="p-5 space-y-4">

            {/* ─ A) Core Metadata ─ */}
            <CollapsibleSection title="Core Metadata" defaultOpen={true}>
              <div className="space-y-4 pt-2">

                {/* Purpose */}
                <div className="group/field">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Purpose</span>
                    {editingField !== 'description' && (
                      <Button variant="ghost" size="sm" onClick={() => startEdit('description', node.description)} className="h-5 px-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
                        <Edit2 className="h-2.5 w-2.5" />
                      </Button>
                    )}
                  </div>
                  {editingField === 'description' ? (
                    <div className="space-y-2">
                      <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} className="text-sm min-h-[80px]" />
                      <AttachmentList contextType="node" contextId={node.id} field="description" currentUser={googleUser} />
                      <div className="flex gap-2">
                        <SaveButton onClick={() => saveEdit('description')} />
                        <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <FormattedText text={node.description} />
                      <AttachmentList contextType="node" contextId={node.id} field="description" currentUser={googleUser} readOnly />
                    </>
                  )}
                </div>

                {/* Inputs & Outputs */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="group/field">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Inputs</span>
                      {editingField !== 'inputs' && (
                        <Button variant="ghost" size="sm" onClick={() => startEdit('inputs', node.inputs)} className="h-5 px-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
                          <Edit2 className="h-2.5 w-2.5" />
                        </Button>
                      )}
                    </div>
                    {editingField === 'inputs' ? (
                      <div className="space-y-2">
                        <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="One per line" className="text-sm min-h-[60px]" />
                        <AttachmentList contextType="node" contextId={node.id} field="inputs" currentUser={googleUser} />
                        <div className="flex gap-2">
                          <SaveButton onClick={() => saveEdit('inputs')} />
                          <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ul className="text-sm space-y-0.5">
                          {node.inputs.map((input, i) => (
                            <li key={i} className="text-gray-600 text-xs">• {input}</li>
                          ))}
                          {node.inputs.length === 0 && <li className="text-gray-400 text-xs italic">None</li>}
                        </ul>
                        <AttachmentList contextType="node" contextId={node.id} field="inputs" currentUser={googleUser} readOnly />
                      </>
                    )}
                  </div>
                  <div className="group/field">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Outputs</span>
                      {editingField !== 'outputs' && (
                        <Button variant="ghost" size="sm" onClick={() => startEdit('outputs', node.outputs)} className="h-5 px-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
                          <Edit2 className="h-2.5 w-2.5" />
                        </Button>
                      )}
                    </div>
                    {editingField === 'outputs' ? (
                      <div className="space-y-2">
                        <Textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="One per line" className="text-sm min-h-[60px]" />
                        <AttachmentList contextType="node" contextId={node.id} field="outputs" currentUser={googleUser} />
                        <div className="flex gap-2">
                          <SaveButton onClick={() => saveEdit('outputs')} />
                          <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ul className="text-sm space-y-0.5">
                          {node.outputs.map((output, i) => (
                            <li key={i} className="text-gray-600 text-xs">• {output}</li>
                          ))}
                          {node.outputs.length === 0 && <li className="text-gray-400 text-xs italic">None</li>}
                        </ul>
                        <AttachmentList contextType="node" contextId={node.id} field="outputs" currentUser={googleUser} readOnly />
                      </>
                    )}
                  </div>
                </div>

                {/* Owner */}
                <div className="group/field">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Owner</span>
                    {editingField !== 'owner' && (
                      <Button variant="ghost" size="sm" onClick={() => startEdit('owner', node.owner || '')} className="h-5 px-1.5 opacity-0 group-hover/field:opacity-100 transition-opacity">
                        <Edit2 className="h-2.5 w-2.5" />
                      </Button>
                    )}
                  </div>
                  {editingField === 'owner' ? (
                    <div className="space-y-2">
                      <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Owner name" className="text-sm" />
                      <div className="flex gap-2">
                        <SaveButton onClick={() => saveEdit('owner')} />
                        <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">{node.owner || 'Not assigned'}</p>
                  )}
                </div>

                {/* Last Updated */}
                <div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Last Updated</span>
                  <p className="text-xs text-gray-500 mt-0.5">{format(node.lastUpdated, 'MMM d, yyyy')}</p>
                </div>

                {/* Tags */}
                <div>
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Tags</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {nodeTags.map((tag) => (
                      <Badge key={tag.id} style={{ backgroundColor: tag.color }} className="text-white text-[10px] cursor-pointer hover:opacity-80 px-1.5 py-0" onClick={() => handleRemoveTag(tag.id)}>
                        {tag.label} <X className="h-2.5 w-2.5 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2">
                    {!showTagCreator ? (
                      <div className="flex gap-2">
                        <Select onValueChange={handleAddTag}>
                          <SelectTrigger className="text-xs h-7 flex-1"><SelectValue placeholder="Add tag..." /></SelectTrigger>
                          <SelectContent>
                            {allTags.filter((t) => !node.tags.includes(t.id)).map((tag) => (
                              <SelectItem key={tag.id} value={tag.id}>
                                <div className="flex items-center gap-1.5">
                                  <div className="h-2.5 w-2.5 rounded" style={{ backgroundColor: tag.color }} />
                                  {tag.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={() => setShowTagCreator(true)} className="h-7 text-xs px-2">
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2 p-2 border rounded-lg bg-gray-50">
                        <Input placeholder="Tag label" value={newTagLabel} onChange={(e) => setNewTagLabel(e.target.value)} className="text-xs h-7" />
                        <div className="flex gap-2">
                          <Input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="w-12 h-7" />
                          <Button size="sm" onClick={handleCreateTag} className="flex-1 h-7 text-xs">Create</Button>
                          <Button size="sm" variant="outline" onClick={() => setShowTagCreator(false)} className="h-7 text-xs">Cancel</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleSection>

            {/* ─ B) Weekly Updates (timeline) ─ */}
            <CollapsibleSection
              title="Weekly Updates"
              icon={<Calendar className="h-3.5 w-3.5 text-blue-500" />}
              defaultOpen={true}
              badge={
                <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5 font-semibold">{localUpdates.length}</span>
              }
            >
              <div className="pt-2">
                <Button size="sm" variant="outline" onClick={handleAddWeeklyUpdate} className="w-full mb-3 h-7 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add weekly update
                </Button>
                <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
                  {localUpdates.length === 0 && (
                    <p className="text-xs text-gray-400 italic text-center py-4">No weekly updates yet.</p>
                  )}
                  {localUpdates.map((entry, idx) => (
                    <div
                      key={entry.id}
                      ref={idx === 0 ? newUpdateRef : undefined}
                      className="relative pl-5 pb-3 border-l-2 border-blue-200 last:pb-0"
                    >
                      {/* Timeline dot */}
                      <div className="absolute left-[-5px] top-0.5 w-2 h-2 rounded-full bg-blue-400" />

                      {editingUpdateId === entry.id ? (
                        <div className="space-y-2">
                          <Input
                            type="date"
                            value={editingUpdateDate}
                            onChange={(e) => setEditingUpdateDate(e.target.value)}
                            className="text-xs h-7 w-40"
                          />
                          <MentionTextarea
                            value={editingUpdateText}
                            onChange={setEditingUpdateText}
                            onMentionsChange={setEditingUpdateMentions}
                            placeholder="What happened this week? Type @ to mention someone."
                            className="min-h-[80px]"
                            autoFocus
                          />
                          {/* Attachments for this weekly update entry */}
                          <AttachmentList
                            contextType="node"
                            contextId={entry.id}
                            field="weekly_update"
                            currentUser={googleUser}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleSaveWeeklyUpdate(entry.id)} className="h-7 text-xs">
                              <Check className="h-3 w-3 mr-1" /> Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditingUpdateId(null)} className="h-7 text-xs">Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="group/entry">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-gray-500">{formatDateLabel(entry.date)}</span>
                            <div className="flex gap-1 opacity-0 group-hover/entry:opacity-100 transition-opacity">
                              <Button variant="ghost" size="sm" onClick={() => { setEditingUpdateId(entry.id); setEditingUpdateText(entry.text); setEditingUpdateDate(entry.date); }} className="h-5 px-1">
                                <Edit2 className="h-2.5 w-2.5" />
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => handleDeleteWeeklyUpdate(entry.id)} className="h-5 px-1 text-red-500 hover:text-red-700">
                                <Trash2 className="h-2.5 w-2.5" />
                              </Button>
                            </div>
                          </div>
                          {entry.text ? <FormattedText text={entry.text} className="text-gray-600" /> : <p className="text-xs text-gray-400 italic">Empty entry</p>}
                          {/* Read-only attachment list in display mode */}
                          <AttachmentList
                            contextType="node"
                            contextId={entry.id}
                            field="weekly_update"
                            currentUser={googleUser}
                            readOnly
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleSection>

            {/* ─ C) Remaining in MVP Scope ─ */}
            <CollapsibleSection
              title="Remaining in MVP Scope"
              icon={<Target className="h-3.5 w-3.5 text-emerald-500" />}
              defaultOpen={false}
            >
              <div className="pt-2 max-h-[240px] overflow-y-auto">
                <Textarea
                  value={remainingDraft}
                  onChange={(e) => {
                    setRemainingDraft(e.target.value);
                    setRemainingDirty(true);
                    onEditStart?.(node.id);
                    onUpdateNode(node.id, { remainingMvpScope: e.target.value });
                  }}
                  onBlur={() => {
                    if (remainingDirty) {
                      setRemainingDirty(false);
                      onEditEnd?.(node.id);
                    }
                  }}
                  placeholder="What's left to ship in Q1?"
                  className="text-sm min-h-[100px] resize-y border-0 shadow-none focus-visible:ring-0 p-0"
                />
                {remainingDirty && <span className="text-[10px] text-amber-500 mt-1">Unsaved</span>}
                <AttachmentList contextType="node" contextId={node.id} field="remaining_mvp_scope" currentUser={googleUser} />
              </div>
            </CollapsibleSection>

            {/* ─ D) Blockers ─ */}
            <CollapsibleSection
              title="Blockers"
              icon={<AlertTriangle className="h-3.5 w-3.5 text-red-400" />}
              defaultOpen={false}
              tint="border-red-100"
            >
              <div className="pt-2 max-h-[240px] overflow-y-auto">
                <Textarea
                  value={blockersDraft}
                  onChange={(e) => {
                    setBlockersDraft(e.target.value);
                    setBlockersDirty(true);
                    onEditStart?.(node.id);
                    onUpdateNode(node.id, { blockers: e.target.value });
                  }}
                  onBlur={() => {
                    if (blockersDirty) {
                      setBlockersDirty(false);
                      onEditEnd?.(node.id);
                    }
                  }}
                  placeholder="Current risks, blockers, or issues..."
                  className="text-sm min-h-[80px] resize-y border-0 shadow-none focus-visible:ring-0 p-0"
                />
                {blockersDirty && <span className="text-[10px] text-amber-500 mt-1">Unsaved</span>}
                <AttachmentList contextType="node" contextId={node.id} field="blockers" currentUser={googleUser} />
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* ═══════ TAB: Future Scope ═══════ */}
        {activeTab === 'future' && (
          <div className="p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-medium text-gray-700">Future Scope</h3>
              </div>
              <p className="text-xs text-gray-400 mb-3">Ideas, enhancements, and work beyond Q1 MVP.</p>
            </div>
            <Textarea
              value={futureScopeDraft}
              onChange={(e) => { setFutureScopeDraft(e.target.value); setFutureScopeDirty(true); }}
              placeholder="Ideas, enhancements, and work beyond Q1 MVP."
              className="text-sm min-h-[240px] resize-y"
            />
            <AttachmentList contextType="node" contextId={node.id} field="future_scope" currentUser={googleUser} />
            <div className="flex items-center gap-3">
              <SaveButton onClick={handleSaveFutureScope} currentSaveState={futureScopeSaveState} />
              {futureScopeDirty && futureScopeSaveState === 'idle' && <span className="text-xs text-amber-600">Unsaved changes</span>}
              {futureScopeSaveState === 'error' && <span className="text-xs text-red-500">Save failed — try again</span>}
            </div>
          </div>
        )}

        {/* ═══════ TAB: Discussion & Decisions ═══════ */}
        {activeTab === 'discussion' && (
          <div className="p-5 space-y-4">
            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Discussion & Questions</h3>

            <div className="space-y-3">
              {node.comments.length === 0 && (
                <p className="text-sm text-gray-400 italic text-center py-4">No comments yet. Start the discussion below.</p>
              )}
              {node.comments.map((comment) => (
                <div key={comment.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-start justify-between mb-1.5">
                    <div className="flex-1">
                      <span className="text-gray-900 font-medium text-xs">{comment.author}</span>
                      <span className="text-gray-400 text-[10px] ml-2">{format(comment.timestamp, 'MMM d, h:mm a')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Select value={comment.status} onValueChange={(value) => handleUpdateCommentStatus(comment.id, value as Comment['status'])}>
                        <SelectTrigger className="w-[90px] h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="answered">Answered</SelectItem>
                          <SelectItem value="parked">Parked</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" onClick={() => { if (window.confirm('Delete this comment?')) handleDeleteComment(comment.id); }} className="h-6 px-1.5 text-red-500 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="h-2.5 w-2.5" />
                      </Button>
                    </div>
                  </div>
                  <FormattedText text={comment.text} className="text-gray-700" />
                  {comment.mentions.length > 0 && (
                    <div className="flex gap-1 mt-1.5">
                      {comment.mentions.map((mention) => (
                        <Badge key={mention} variant="outline" className="text-[10px] px-1.5 py-0">@{mention}</Badge>
                      ))}
                    </div>
                  )}
                  {/* Attachments for this comment (read-only in display mode) */}
                  <AttachmentList
                    contextType="node"
                    contextId={comment.id}
                    field="comment"
                    currentUser={googleUser}
                    readOnly
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t pt-3">
              <Input placeholder="Your name" value={commentAuthor} onChange={(e) => setCommentAuthor(e.target.value)} className="text-sm h-8" />
              <MentionTextarea
                value={newComment}
                onChange={setNewComment}
                onMentionsChange={setNewCommentMentions}
                placeholder="Add a comment or question… type @ to mention someone"
                rows={3}
                className="min-h-[70px]"
              />
              {/* Pending comment attachments — keyed by a draft ID so they can be linked after the comment is saved */}
              <AttachmentList
                contextType="node"
                contextId={`draft-comment-${node.id}`}
                field="comment"
                currentUser={googleUser}
              />
              <Button size="sm" onClick={handleAddComment} className="w-full h-8 text-xs">
                <Send className="h-3 w-3 mr-1" /> Add Comment
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── STICKY FOOTER ── */}
      <div className="flex-shrink-0 bg-white border-t px-5 py-3">
        <Button variant="destructive" className="w-full h-8 text-xs" onClick={() => onDeleteNode(node.id)}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Node
        </Button>
      </div>
    </div>
  );
}
