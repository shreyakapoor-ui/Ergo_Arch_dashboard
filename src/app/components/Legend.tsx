import type { ComponentNode } from '../types/architecture';

interface LegendProps {
  components: ComponentNode[];
}

export function Legend({ components }: LegendProps) {
  // Count components by status
  const statusCounts = {
    built: components.filter(c => c.status === 'built').length,
    'in-progress': components.filter(c => c.status === 'in-progress').length,
    planned: components.filter(c => c.status === 'planned').length,
    'open-question': components.filter(c => c.status === 'open-question').length,
  };

  const totalComments = components.reduce((sum, c) => sum + (c.comments?.length || 0), 0);

  return (
    <div className="fixed top-[80px] right-6 bg-white border rounded-lg shadow-lg p-4 text-xs z-30">
      <h3 className="font-semibold mb-3">Status Overview</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-50" />
            <span>Built</span>
          </div>
          <span className="font-semibold text-green-600">{statusCounts.built}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-yellow-500 bg-yellow-50" />
            <span>In Progress</span>
          </div>
          <span className="font-semibold text-yellow-600">{statusCounts['in-progress']}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-gray-400 bg-gray-50" />
            <span>Planned</span>
          </div>
          <span className="font-semibold text-gray-600">{statusCounts.planned}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded border-2 border-red-500 bg-red-50" />
            <span>Open Question</span>
          </div>
          <span className="font-semibold text-red-600">{statusCounts['open-question']}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white">
            {totalComments}
          </div>
          <span>Total comments</span>
        </div>
      </div>
    </div>
  );
}
