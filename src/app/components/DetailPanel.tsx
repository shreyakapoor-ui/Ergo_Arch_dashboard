import { ComponentNode, Tag, Comment } from '../types/architecture';
import { X, Plus, Send, Edit2, Check, Presentation, Trash2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { Label } from './ui/label';
import { useState } from 'react';
import { format } from 'date-fns';

interface DetailPanelProps {
  node: ComponentNode | null;
  tags: Tag[];
  allTags: Tag[];
  onClose: () => void;
  onUpdateNode: (nodeId: string, updates: Partial<ComponentNode>) => void;
  onDeleteNode: (nodeId: string) => void;
  onCreateTag: (label: string, color: string) => void;
}

export function DetailPanel({ node, tags, allTags, onClose, onUpdateNode, onDeleteNode, onCreateTag }: DetailPanelProps) {
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [newComment, setNewComment] = useState('');
  const [commentAuthor, setCommentAuthor] = useState('');
  const [showTagCreator, setShowTagCreator] = useState(false);
  const [walkthroughMode, setWalkthroughMode] = useState(false);

  // Edit states
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

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
    setEditingField(field);
    setEditValue(Array.isArray(currentValue) ? currentValue.join('\n') : currentValue);
  };

  const saveEdit = (field: string) => {
    if (field === 'inputs' || field === 'outputs') {
      const arrayValue = editValue.split('\n').filter((line) => line.trim());
      onUpdateNode(node.id, { [field]: arrayValue });
    } else {
      onUpdateNode(node.id, { [field]: editValue });
    }
    setEditingField(null);
    setEditValue('');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  return (
    <div className="fixed right-0 top-0 h-full w-[500px] border-l bg-white shadow-2xl overflow-y-auto z-50">
      <div className="sticky top-0 bg-white border-b p-6 z-10">
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
                  <Button size="sm" onClick={() => saveEdit('name')}>
                    <Check className="h-3 w-3 mr-1" /> Save
                  </Button>
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
                  <Button size="sm" onClick={() => saveEdit('status')}>
                    <Check className="h-3 w-3 mr-1" /> Save
                  </Button>
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
        <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
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
          <p className="text-xs text-gray-500 mt-2">
            Client-facing view: showing only purpose, work done, and resources
          </p>
        )}
      </div>

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
                <Button size="sm" onClick={() => saveEdit('description')}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed">{node.description}</p>
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
                  <Button size="sm" onClick={() => saveEdit('inputs')}>
                    <Check className="h-3 w-3 mr-1" /> Save
                  </Button>
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
                  <Button size="sm" onClick={() => saveEdit('outputs')}>
                    <Check className="h-3 w-3 mr-1" /> Save
                  </Button>
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
                <Button size="sm" onClick={() => saveEdit('owner')}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
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
                <Button size="sm" onClick={() => saveEdit('workDone')}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {node.workDone || 'No work documented yet'}
            </p>
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
                <Button size="sm" onClick={() => saveEdit('inDevelopment')}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {node.inDevelopment || 'Nothing currently in development'}
            </p>
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
                <Button size="sm" onClick={() => saveEdit('blocker')}>
                  <Check className="h-3 w-3 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {node.blocker || 'No blockers'}
            </p>
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

        {/* Discussion Thread */}
        {!walkthroughMode && (
          <section>
            <h3 className="text-sm text-gray-500 mb-3">Discussion & Questions</h3>
            
            <div className="space-y-3 mb-4">
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
                  <p className="text-gray-700 leading-relaxed">{comment.text}</p>
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
        )}
      </div>

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