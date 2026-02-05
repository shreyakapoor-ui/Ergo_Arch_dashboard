import { Tag, MilestoneView } from '../types/architecture';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Eye, EyeOff, Filter, Milestone, X, FileImage } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface ArchitectureControlsProps {
  showStatusOverlay: boolean;
  onToggleStatusOverlay: () => void;
  allTags: Tag[];
  activeFilterTags: string[];
  onToggleFilterTag: (tagId: string) => void;
  onClearFilters: () => void;
  milestones: MilestoneView[];
  onSelectMilestone: (milestoneId: string | null) => void;
  activeMilestone: string | null;
  onShowDiagram: () => void;
}

export function ArchitectureControls({
  showStatusOverlay,
  onToggleStatusOverlay,
  allTags,
  activeFilterTags,
  onToggleFilterTag,
  onClearFilters,
  milestones,
  onSelectMilestone,
  activeMilestone,
  onShowDiagram,
}: ArchitectureControlsProps) {
  const activeMilestoneObj = milestones.find((m) => m.id === activeMilestone);

  return (
    <div className="sticky top-0 z-40 bg-white border-b shadow-sm">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl">Ergo Overwatch Architecture</h1>
            <p className="text-sm text-gray-500 mt-1">MVP POC System Map</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onShowDiagram}
              className="bg-blue-50 border-blue-300 hover:bg-blue-100"
            >
              <FileImage className="h-4 w-4 mr-2" /> View Official Diagram
            </Button>

            <Button
              variant={showStatusOverlay ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleStatusOverlay}
            >
              {showStatusOverlay ? (
                <>
                  <Eye className="h-4 w-4 mr-2" /> Status View
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-2" /> Diagram View
                </>
              )}
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Filter Tags
                  {activeFilterTags.length > 0 && (
                    <Badge className="ml-2 h-5 w-5 rounded-full p-0 flex items-center justify-center">
                      {activeFilterTags.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm">Filter by tags</h3>
                    {activeFilterTags.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="h-7 text-xs"
                      >
                        Clear all
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((tag) => {
                      const isActive = activeFilterTags.includes(tag.id);
                      return (
                        <Badge
                          key={tag.id}
                          style={{
                            backgroundColor: isActive ? tag.color : 'transparent',
                            color: isActive ? 'white' : tag.color,
                            borderColor: tag.color,
                          }}
                          className="cursor-pointer border"
                          onClick={() => onToggleFilterTag(tag.id)}
                        >
                          {tag.label}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Select
              value={activeMilestone || 'none'}
              onValueChange={(value) => onSelectMilestone(value === 'none' ? null : value)}
            >
              <SelectTrigger className="w-[240px]">
                <Milestone className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Select milestone view..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All Components</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Active Milestone Info */}
        {activeMilestoneObj && (
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <Milestone className="h-4 w-4 text-blue-600" />
            <div className="flex-1">
              <div className="text-sm">{activeMilestoneObj.name}</div>
              <div className="text-xs text-gray-600">{activeMilestoneObj.description}</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onSelectMilestone(null)}
              className="h-7 w-7"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Active Tag Filters */}
        {activeFilterTags.length > 0 && !activeMilestoneObj && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Active filters:</span>
            {activeFilterTags.map((tagId) => {
              const tag = allTags.find((t) => t.id === tagId);
              if (!tag) return null;
              return (
                <Badge
                  key={tag.id}
                  style={{ backgroundColor: tag.color }}
                  className="text-white cursor-pointer hover:opacity-80"
                  onClick={() => onToggleFilterTag(tag.id)}
                >
                  {tag.label} <X className="h-3 w-3 ml-1" />
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}