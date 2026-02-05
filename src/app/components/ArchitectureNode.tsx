import { ComponentNode, Tag } from '../types/architecture';
import { Badge } from './ui/badge';
import { Move } from 'lucide-react';

interface ArchitectureNodeProps {
  node: ComponentNode;
  tags: Tag[];
  onClick: () => void;
  showStatusOverlay: boolean;
  onDragStart?: (e: React.MouseEvent) => void;
  connectionMode?: boolean;
  isConnectionStart?: boolean;
}

export function ArchitectureNode({ 
  node, 
  tags, 
  onClick, 
  showStatusOverlay,
  onDragStart,
  connectionMode,
  isConnectionStart,
}: ArchitectureNodeProps) {
  const nodeTags = tags.filter((t) => node.tags.includes(t.id));
  
  const getStatusColor = () => {
    switch (node.status) {
      case 'built':
        return 'bg-green-50 border-green-500';
      case 'in-progress':
        return 'bg-yellow-50 border-yellow-500';
      case 'planned':
        return 'bg-gray-50 border-gray-400';
      case 'open-question':
        return 'bg-red-50 border-red-500 border-2';
      default:
        return 'bg-white border-gray-300';
    }
  };

  const hasOpenComments = node.comments.some((c) => c.status === 'open');

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if clicking on the drag handle
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      e.stopPropagation();
      onDragStart?.(e);
    }
  };

  const getBorderStyle = () => {
    if (connectionMode && isConnectionStart) {
      return 'border-blue-500 border-4 shadow-xl';
    }
    if (connectionMode) {
      return 'border-green-500 border-4 shadow-lg hover:border-green-600';
    }
    if (showStatusOverlay) {
      return getStatusColor();
    }
    return 'bg-white border-gray-300 hover:border-blue-500';
  };

  // Check if this is one of the 4 agent nodes
  const isAgentNode = ['finance-agent', 'legal-agent', 'operations-agent', 'strategy-agent'].includes(node.id);
  const nodeWidth = isAgentNode ? '160px' : '220px';
  const nodeSize = isAgentNode ? 'text-xs' : 'text-sm';

  return (
    <div
      onClick={onClick}
      onMouseDown={handleMouseDown}
      className={`
        absolute cursor-pointer rounded-lg border-2 p-4 transition-all hover:shadow-lg
        ${getBorderStyle()}
      `}
      style={{
        left: `${node.position.x}px`,
        top: `${node.position.y}px`,
        width: nodeWidth,
      }}
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1">
            {!connectionMode && (
              <div 
                className="drag-handle cursor-move mt-0.5 hover:bg-gray-200 rounded p-0.5"
                title="Drag to move"
              >
                <Move className="h-3 w-3 text-gray-400" />
              </div>
            )}
            <h3 className={`${nodeSize} leading-tight flex-1`}>{node.name}</h3>
          </div>
          {hasOpenComments && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white">
              {node.comments.filter((c) => c.status === 'open').length}
            </span>
          )}
        </div>
        
        {nodeTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {nodeTags.map((tag) => (
              <Badge
                key={tag.id}
                style={{ backgroundColor: tag.color }}
                className="text-[9px] px-1.5 py-0 h-4 text-white"
              >
                {tag.label}
              </Badge>
            ))}
          </div>
        )}

        {connectionMode && (
          <div className="text-[10px] text-gray-500 mt-1">
            {isConnectionStart ? 'Source selected. Click target.' : 'Click to connect'}
          </div>
        )}
      </div>
    </div>
  );
}