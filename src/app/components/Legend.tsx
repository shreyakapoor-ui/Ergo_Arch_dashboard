export function Legend() {
  return (
    <div className="fixed bottom-6 left-6 bg-white border rounded-lg shadow-lg p-4 text-xs z-30">
      <h3 className="mb-3">Status Legend</h3>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-green-500 bg-green-50" />
          <span>Built</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-yellow-500 bg-yellow-50" />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-gray-400 bg-gray-50" />
          <span>Planned</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded border-2 border-red-500 bg-red-50" />
          <span>Open Question / Risk</span>
        </div>
      </div>
      
      <div className="mt-4 pt-3 border-t">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white">
            3
          </div>
          <span>Open comments</span>
        </div>
      </div>
    </div>
  );
}
