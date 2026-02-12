import { Tag, MilestoneView } from '../types/architecture';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Milestone, X, FileImage, Map, ExternalLink } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface ArchitectureControlsProps {
  allTags: Tag[];
  milestones: MilestoneView[];
  onSelectMilestone: (milestoneId: string | null) => void;
  activeMilestone: string | null;
  onShowDiagram: () => void;
  onShowRoadmap: () => void;
}

export function ArchitectureControls({
  allTags,
  milestones,
  onSelectMilestone,
  activeMilestone,
  onShowDiagram,
  onShowRoadmap,
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

            <a
              href="http://51.21.130.110:8501/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="bg-green-50 border-green-300 hover:bg-green-100"
              >
                <ExternalLink className="h-4 w-4 mr-2" /> Streamlit
              </Button>
            </a>

            <a
              href="https://dashboard.promptlayer.com/workspace/55722/home"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant="outline"
                size="sm"
                className="bg-amber-50 border-amber-300 hover:bg-amber-100"
              >
                <ExternalLink className="h-4 w-4 mr-2" /> Prompt Layer
              </Button>
            </a>

            <Button
              variant="outline"
              size="sm"
              onClick={onShowRoadmap}
              className="bg-purple-50 border-purple-300 hover:bg-purple-100"
            >
              <Map className="h-4 w-4 mr-2" /> Roadmap
            </Button>

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
      </div>
    </div>
  );
}
