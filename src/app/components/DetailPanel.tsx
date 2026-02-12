import { ComponentNode, Tag, Comment } from '../types/architecture';
import { X, Plus, Send, Edit2, Check, Presentation, Trash2, RefreshCw, Rocket, Lightbulb, MessageSquare } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';

type PanelTab = 'mvp' | 'future' | 'discussion';

interface DetailPanelProps {
  node: ComponentNode | null;
  tags: Tag[];
  allTags: Tag[];
  onClose: () => void;
  onUpdateNode: (nodeId: string, updates: Partial<ComponentNode>) => Promise<void>;
  onDeleteNode: (nodeId: string) => void;
  onCreateTag: (label: string, color: string) => void;
  onEditStart?: (nodeId: string) => void;
  onEditEnd?: () => void;
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
  isResizing?: boolean;
}

export function DetailPanel({ node, tags, allTags, onClose, onUpdateNode, onDeleteNode, onCreateTag, onEditStart, onEditEnd, width = 500, onResizeStart, isResizing = false }: DetailPanelProps) {
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [newComment, setNewComment] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [showTagCreator, setShowTagCreator] = useState(false);
  const [walkthroughMode, setWalkthroughMode] = useState(false);

  // Tab state
  const [activeTab, setActiveTab] = useState<PanelTab>('mvp');

  // Edit states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Future Scope local draft state (persists across tab switches within same node)
  const [futureScopeDraft, setFutureScopeDraft] = useState('');
  const [futureScopeDirty, setFutureScopeDirty] = useState(false);
  const [futureScopeSaveState, setFutureScopeSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const prevNodeIdRef = useRef<string | null>(null);

  // Reset tab to MVP and sync future scope draft when node changes
  useEffect(() => {
    if (node && node.id !== prevNodeIdRef.current) {
      setActiveTab('mvp');
      setFutureScopeDraft(node.futureScope || '');
      setFutureScopeDirty(false);
      setFutureScopeSaveState('idle');
      prevNodeIdRef.current = node.id;
    }
  }, [node?.id]);

  // Keep draft in sync when node data updates from remote (only if user hasn't made local edits)
  useEffect(() => {
    if (node && !futureScopeDirty) {
      setFutureScopeDraft(node.futureScope || '');
    }
  }, [node?.futureScope, futureScopeDirty]);

  // Signal edit end when panel closes or node changes
  useEffect(() => {
    return () => {
      onEditEnd?.();
    };
  }, [node?.id, onEditEnd]);

  if (!node) return null;

  const nodeTags = tags.filter((t) => node.tags.includes(t.id));

  const handleAddTag = (tagId: string) => {
    if (!node.tags.includes(tagId)) {
      onUpdateNode(node.id, { tags: [...node.tags, tagId] });
    }
  };

  const handleRemoveTag = (tagId: string) => {
    onUpdateNode(node.id, { tags: node.tags.filter((t) => t !== tagId) });
  };

  const handleCreateTag = () => {
    if (newTagLabel.trim()) {
      onCreateTag(newTagLabel.trim(), newTagColor);
      setNewTagLabel('');
      setShowTagCreator(false);
    }
  };

  const handleAddComment = () => {
    if (newComment.trim() && commentAuthor.trim()) {
      const comment: Comment = {
        id: `c-${Date.now()}`,
        text: newComment,
        author: commentAuthor,
        timestamp: new Date(),
        mentions: extractMentions(newComment),
        status: 'open',
      };
      onUpdateNode(node.id, { comments: [...node.comments, comment] });
      setNewComment('');
    }
  };

  const handleUpdateCommentStatus = (commentId: string, status: Comment['status']) => {
    const updatedComments = node.comments.map((c) =>
      c.id === commentId ? { ...c, status } : c
    );
    onUpdateNode(node.id, { comments: updatedComments });
  };

  const handleDeleteComment = (commentId: string) => {
    const updatedComments = node.comments.filter((c) => c.id !== commentId);
    onUpdateNode(node.id, { comments: updatedComments });
  };

  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@(\w+)/g;
    const matches = text.match(mentionRegex);
    return matches ? matches.map((m) => m.substring(1)) : [];
  };

  // Future Scope save handler
  const handleSaveFutureScope = async () => {
    setFutureScopeSaveState('saving');
    onEditStart?.(node.id);

    try {
      await onUpdateNode(node.id, { futureScope: futureScopeDraft });
      setFutureScopeSaveState('saved');
      setFutureScopeDirty(false);
      setTimeout(() => {
        setFutureScopeSaveState('idle');
        onEditEnd?.();
      }, 1000);
    } catch (error) {
      console.error('Save failed:', error);
      setFutureScopeSaveState('error');
      setTimeout(() => {
        setFutureScopeSaveState('idle');
      }, 2000);
    }
  };

  // Helper to render text with proper formatting (line breaks, bullets, paragraphs)
  const FormattedText = ({ text, className = '' }: { text: string; className?: string }) => {
    if (!text) return null;

    // Split into lines and render with proper formatting
    const lines = text.split('\n');

    return (
      <div className={`text-sm leading-relaxed ${className}`}>
        {lines.map((line, i) => {
          const trimmedLine = line.trim();

          // Empty line = paragraph break
          if (!trimmedLine) {
            return <div key={i} className="h-2" />;
          }

          // Bullet point lines (-, *, •)
          if (/^[-*•]\s/.test(trimmedLine)) {
            return (
              <div key={i} className="flex gap-2 ml-2">
                <span className="text-gray-400">•</span>
                <span>{trimmedLine.replace(/^[-*•]\s*/, '')}</span>
              </div>
            );
          }

          // Numbered list (1., 2., etc.)
          const numberedMatch = trimmedLine.match(/^(\d+)[.)]\s*(.*)/);
          if (numberedMatch) {
            return (
              <div key={i} className="flex gap-2 ml-2">
                <span className="text-gray-400 min-w-[1.5rem]">{numberedMatch[1]}.</span>
                <span>{numberedMatch[2]}</span>
              </div>
            );
          }

          // Regular line
          return <p key={i}>{line}</p>;
        })}
      </div>
    );
  };

  const getStatusBadgeColor = () => {
    switch (node.status) {
      case 'built':
        return 'bg-green-500';
      case 'in-progress':
        return 'bg-yellow-500';
      case 'planned':
        return 'bg-gray-400';
      case 'open-question':
        return 'bg-red-500';
    }
  };

  const getStatusLabel = () => {
    switch (node.status) {
      case 'built':
        return 'Built';
      case 'in-progress':
        return 'In Progress';
      case 'planned':
        return 'Planned';
      case 'open-question':
        return 'Open Question';
    }
  };

  const startEdit = (field: string, currentValue: string | string[]) => {
    onEditStart?.(node.id);
    setEditingField(field);
    setEditValue(Array.isArray(currentValue) ? currentValue.join('\n') : currentValue);
  };

  const saveEdit = async (field: string) => {
    setSaveState('saving');

    try {
      // Prepare the update
      const updates = field === 'inputs' || field === 'outputs'
        ? { [field]: editValue.split('\n').filter((line) => line.trim()) }
        : { [field]: editValue };

      // Await actual Supabase save - this resolves when save completes
      await onUpdateNode(node.id, updates);

      // Save succeeded!
      setSaveState('saved');

      // Show success for 1 second, then close edit mode
      setTimeout(() => {
        setSaveState('idle');
        setEditingField(null);
        setEditValue('');
        onEditEnd?.();
      }, 1000);
    } catch (error) {
      console.error('Save failed:', error);
      setSaveState('error');

      // Show error for 2 seconds, then reset (keep edit mode open so user can retry)
      setTimeout(() => {
        setSaveState('idle');
      }, 2000);
    }
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
    setSaveState('idle');
    onEditEnd?.();
  };

  // Reusable Save button with loading/success states
  const SaveButton = ({ onClick, currentSaveState }: { onClick: () => void; currentSaveState?: 'idle' | 'saving' | 'saved' | 'error' }) => {
    const state = currentSaveState ?? saveState;
    return (
      <Button
        size="sm"
        onClick={onClick}
        disabled={state === 'saving'}
        className="transform transition-all duration-150 hover:scale-[1.03] hover:shadow-md active:scale-[0.98]"
      >
        {state === 'saving' ? (
          <>
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            Saving…
          </>
        ) : state === 'saved' ? (
          <>
            <Check className="h-3 w-3 mr-1 text-green-500" />
            Saved ✓
          </>
        ) : (
          <>
            <Check className="h-3 w-3 mr-1" />
            Save
          </>
        )}
      </Button>
    );
  };

  // Tab definitions
  const tabs: { id: PanelTab; label: string; icon: React.ReactNode }[] = [
    { id: 'mvp', label: 'MVP Scope (Q1)', icon: <Rocket className="h-3.5 w-3.5" /> },
    { id: 'future', label: 'Future Scope', icon: <Lightbulb className="h-3.5 w-3.5" /> },
    { id: 'discussion', label: 'Discussion', icon: <MessageSquare className="h-3.5 w-3.5" /> },
  ];

  return (
    <div
      className="fixed right-0 top-0 h-full border-l bg-white shadow-2xl overflow-y-auto z-50"
      style={{
        width: `${width}px`,
        userSelect: isResizing ? 'none' : undefined,
      }}
    >
      {/* Resize Handle */}
      {onResizeStart && (
        <div
          onMouseDown={onResizeStart}
          className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize z-[60] group"
          style={{ transform: 'translateX(-50%)' }}
        >
          {/* Visible indicator line on hover / during drag */}
          <div
            className={`h-full w-0.5 mx-auto transition-colors duration-150 ${
              isResizing ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-400'
            }`}
          />
          {/* Wider invisible hit area */}
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}
      <div className="sticky top-0 bg-white border-b p-6 pb-0 z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            {editingField === 'name' ? (
              <div className="space-y-2 mb-2">
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Node name"
                  className="text-xl font-semibold"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('name')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-xl">{node.name}</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('name', node.name)}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Badge className={`${getStatusBadgeColor()} text-white`}>
                {getStatusLabel()}
              </Badge>
              {editingField !== 'status' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('status', node.status)}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'status' && (
              <div className="mt-2 space-y-2">
                <Select
                  value={editValue}
                  onValueChange={(value) => setEditValue(value)}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="built">Built</SelectItem>
                    <SelectItem value="in-progress">In Progress</SelectItem>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="open-question">Open Question</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('status')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Walkthrough Mode Toggle */}
        <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
          <div className="flex items-center gap-2">
            <Presentation className="h-4 w-4 text-blue-600" />
            <Label htmlFor="walkthrough-mode" className="text-sm cursor-pointer">
              Walkthrough Mode
            </Label>
          </div>
          <Switch
            id="walkthrough-mode"
            checked={walkthroughMode}
            onCheckedChange={setWalkthroughMode}
          />
        </div>
        {walkthroughMode && (
          <p className="text-xs text-gray-500 mb-4">
            Client-facing view: showing only purpose, work done, and resources
          </p>
        )}

        {/* Segmented Tab Control */}
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium transition-all duration-150 ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              <span className="truncate">{tab.label}</span>
              {tab.id === 'discussion' && node.comments.length > 0 && (
                <span className={`ml-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-semibold ${
                  activeTab === 'discussion'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {node.comments.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ===== TAB: MVP Scope (Q1) ===== */}
      {activeTab === 'mvp' && (
        <div className="p-6 space-y-6">
          {/* Description */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-500">Purpose</h3>
              {editingField !== 'description' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('description', node.description)}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'description' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="text-sm min-h-[100px]"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('description')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <FormattedText text={node.description} />
            )}
          </section>

          {/* Inputs & Outputs */}
          <section className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm text-gray-500">Inputs</h3>
                {editingField !== 'inputs' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit('inputs', node.inputs)}
                    className="h-6 px-2"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {editingField === 'inputs' ? (
                <div className="space-y-2">
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="One input per line"
                    className="text-sm min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <SaveButton onClick={() => saveEdit('inputs')} />
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="text-sm space-y-1">
                  {node.inputs.map((input, i) => (
                    <li key={i} className="text-gray-700">• {input}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm text-gray-500">Outputs</h3>
                {editingField !== 'outputs' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit('outputs', node.outputs)}
                    className="h-6 px-2"
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {editingField === 'outputs' ? (
                <div className="space-y-2">
                  <Textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="One output per line"
                    className="text-sm min-h-[80px]"
                  />
                  <div className="flex gap-2">
                    <SaveButton onClick={() => saveEdit('outputs')} />
                    <Button size="sm" variant="outline" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="text-sm space-y-1">
                  {node.outputs.map((output, i) => (
                    <li key={i} className="text-gray-700">• {output}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Owner */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-500">Owner</h3>
              {editingField !== 'owner' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('owner', node.owner || '')}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'owner' ? (
              <div className="space-y-2">
                <Input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Enter owner name"
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('owner')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm">{node.owner || 'Not assigned'}</p>
            )}
          </section>

          <section className="text-sm text-gray-500">
            Last Updated: {format(node.lastUpdated, 'MMM d, yyyy')}
          </section>

          {/* Work Done */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-500">Work Done</h3>
              {editingField !== 'workDone' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('workDone', node.workDone || '')}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'workDone' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Describe completed work..."
                  className="text-sm min-h-[100px]"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('workDone')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <FormattedText text={node.workDone || 'No work documented yet'} />
            )}
          </section>

          {/* In Development */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-500">In Development</h3>
              {editingField !== 'inDevelopment' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('inDevelopment', node.inDevelopment || '')}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'inDevelopment' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Describe what's currently being developed..."
                  className="text-sm min-h-[100px]"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('inDevelopment')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <FormattedText text={node.inDevelopment || 'Nothing currently in development'} />
            )}
          </section>

          {/* Blocker */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-gray-500">Blocker</h3>
              {editingField !== 'blocker' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit('blocker', node.blocker || '')}
                  className="h-6 px-2"
                >
                  <Edit2 className="h-3 w-3" />
                </Button>
              )}
            </div>
            {editingField === 'blocker' ? (
              <div className="space-y-2">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  placeholder="Describe any blockers..."
                  className="text-sm min-h-[100px]"
                />
                <div className="flex gap-2">
                  <SaveButton onClick={() => saveEdit('blocker')} />
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <FormattedText text={node.blocker || 'No blockers'} />
            )}
          </section>

          {/* Tags */}
          {!walkthroughMode && (
            <section>
              <h3 className="text-sm text-gray-500 mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {nodeTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    style={{ backgroundColor: tag.color }}
                    className="text-white cursor-pointer hover:opacity-80"
                    onClick={() => handleRemoveTag(tag.id)}
                  >
                    {tag.label} <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>

              {!showTagCreator ? (
                <div className="space-y-2">
                  <Select onValueChange={handleAddTag}>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Add existing tag..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allTags
                        .filter((t) => !node.tags.includes(t.id))
                        .map((tag) => (
                          <SelectItem key={tag.id} value={tag.id}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3 w-3 rounded"
                                style={{ backgroundColor: tag.color }}
                              />
                              {tag.label}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowTagCreator(true)}
                    className="w-full"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Create new tag
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 p-3 border rounded-lg bg-gray-50">
                  <Input
                    placeholder="Tag label"
                    value={newTagLabel}
                    onChange={(e) => setNewTagLabel(e.target.value)}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={newTagColor}
                      onChange={(e) => setNewTagColor(e.target.value)}
                      className="w-16"
                    />
                    <Button size="sm" onClick={handleCreateTag} className="flex-1">
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowTagCreator(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ===== TAB: Future Scope ===== */}
      {activeTab === 'future' && (
        <div className="p-6 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <h3 className="text-sm font-medium text-gray-700">Future Scope</h3>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Ideas, enhancements, and work beyond Q1 MVP.
            </p>
          </div>
          <Textarea
            value={futureScopeDraft}
            onChange={(e) => {
              setFutureScopeDraft(e.target.value);
              setFutureScopeDirty(true);
            }}
            placeholder="Ideas, enhancements, and work beyond Q1 MVP."
            className="text-sm min-h-[240px] resize-y"
          />
          <div className="flex items-center gap-3">
            <SaveButton onClick={handleSaveFutureScope} currentSaveState={futureScopeSaveState} />
            {futureScopeDirty && futureScopeSaveState === 'idle' && (
              <span className="text-xs text-amber-600">Unsaved changes</span>
            )}
            {futureScopeSaveState === 'error' && (
              <span className="text-xs text-red-500">Save failed — try again</span>
            )}
          </div>
        </div>
      )}

      {/* ===== TAB: Discussion & Decisions ===== */}
      {activeTab === 'discussion' && (
        <div className="p-6 space-y-4">
          {!walkthroughMode ? (
            <section>
              <h3 className="text-sm text-gray-500 mb-3">Discussion & Questions</h3>

              <div className="space-y-3 mb-4">
                {node.comments.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No comments yet. Start the discussion below.</p>
                )}
                {node.comments.map((comment) => (
                  <div key={comment.id} className="border rounded-lg p-3 text-sm">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <span className="text-gray-900">{comment.author}</span>
                        <span className="text-gray-400 text-xs ml-2">
                          {format(comment.timestamp, 'MMM d, h:mm a')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={comment.status}
                          onValueChange={(value) =>
                            handleUpdateCommentStatus(comment.id, value as Comment['status'])
                          }
                        >
                          <SelectTrigger className="w-[110px] h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="open">Open</SelectItem>
                            <SelectItem value="answered">Answered</SelectItem>
                            <SelectItem value="parked">Parked</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm('Delete this comment?')) {
                              handleDeleteComment(comment.id);
                            }
                          }}
                          className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <FormattedText text={comment.text} className="text-gray-700" />
                    {comment.mentions.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {comment.mentions.map((mention) => (
                          <Badge key={mention} variant="outline" className="text-xs">
                            @{mention}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="space-y-2 border-t pt-4">
                <Input
                  placeholder="Your name"
                  value={commentAuthor}
                  onChange={(e) => setCommentAuthor(e.target.value)}
                  className="text-sm"
                />
                <Textarea
                  placeholder="Add a comment or question... (use @name to mention someone)"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="text-sm min-h-[80px]"
                />
                <Button size="sm" onClick={handleAddComment} className="w-full">
                  <Send className="h-3 w-3 mr-1" /> Add Comment
                </Button>
              </div>
            </section>
          ) : (
            <p className="text-sm text-gray-400 italic">
              Discussion is hidden in Walkthrough Mode.
            </p>
          )}
        </div>
      )}

      {/* Delete Node Button */}
      <div className="sticky bottom-0 bg-white border-t p-6">
        <Button
          variant="destructive"
          className="w-full"
          onClick={() => onDeleteNode(node.id)}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete Node
        </Button>
      </div>
    </div>
  );
}
