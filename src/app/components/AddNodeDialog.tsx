import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { X } from 'lucide-react';
import type { ComponentNode, Tag, ComponentStatus } from '../types/architecture';

interface AddNodeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAddNode: (node: ComponentNode) => void;
  existingTags: Tag[];
}

export function AddNodeDialog({ isOpen, onClose, onAddNode, existingTags }: AddNodeDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ComponentStatus>('planned');
  const [owner, setOwner] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (!name.trim()) return;

    const newNode: ComponentNode = {
      id: name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      name: name.trim(),
      description: description.trim(),
      status,
      inputs: [],
      outputs: [],
      owner: owner.trim() || undefined,
      lastUpdated: new Date(),
      tags: selectedTags,
      comments: [],
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      layer: 0,
    };

    onAddNode(newNode);

    // Reset form
    setName('');
    setDescription('');
    setStatus('planned');
    setOwner('');
    setSelectedTags([]);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId)
        ? prev.filter(t => t !== tagId)
        : [...prev, tagId]
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Add New Node</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Data Processor"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this component do?"
              className="min-h-[80px]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Status</label>
            <Select value={status} onValueChange={(value) => setStatus(value as ComponentStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="in-progress">In Progress</SelectItem>
                <SelectItem value="built">Built</SelectItem>
                <SelectItem value="open-question">Open Question</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Owner</label>
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="e.g., Data Team"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Tags</label>
            <div className="flex flex-wrap gap-2">
              {existingTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className="px-3 py-1 text-sm rounded-full border transition-colors"
                  style={{
                    backgroundColor: selectedTags.includes(tag.id) ? tag.color : 'transparent',
                    color: selectedTags.includes(tag.id) ? 'white' : tag.color,
                    borderColor: tag.color,
                  }}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!name.trim()} className="flex-1">
            Add Node
          </Button>
        </div>
      </div>
    </div>
  );
}
