import { useState } from 'react';
import { Button } from './ui/button';
import { X, ArrowRight } from 'lucide-react';

interface AddArrowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAddArrow: (from: string, to: string) => void;
  nodes: string[];
}

export function AddArrowDialog({ isOpen, onClose, onAddArrow, nodes }: AddArrowDialogProps) {
  const [fromNode, setFromNode] = useState('');
  const [toNode, setToNode] = useState('');

  if (!isOpen) return null;

  const handleAdd = () => {
    if (fromNode && toNode && fromNode !== toNode) {
      onAddArrow(fromNode, toNode);
      setFromNode('');
      setToNode('');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-white rounded-lg shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Add Arrow</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">From Node</label>
            <select
              value={fromNode}
              onChange={(e) => setFromNode(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select source node...</option>
              {nodes.map((nodeId) => (
                <option key={nodeId} value={nodeId}>
                  {nodeId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-center">
            <ArrowRight className="h-6 w-6 text-gray-400" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">To Node</label>
            <select
              value={toNode}
              onChange={(e) => setToNode(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select target node...</option>
              {nodes.map((nodeId) => (
                <option key={nodeId} value={nodeId}>
                  {nodeId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </option>
              ))}
            </select>
          </div>

          {fromNode && toNode && fromNode === toNode && (
            <p className="text-sm text-red-500">Source and target nodes must be different</p>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!fromNode || !toNode || fromNode === toNode}
            className="flex-1"
          >
            Add Arrow
          </Button>
        </div>
      </div>
    </div>
  );
}
