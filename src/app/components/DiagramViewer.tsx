import { X } from 'lucide-react';
import { Button } from './ui/button';

interface DiagramViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DiagramViewer({ isOpen, onClose }: DiagramViewerProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-8">
      <div className="bg-white rounded-lg shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-xl">Architecture Diagram</h2>
            <p className="text-sm text-gray-500 mt-1">ERGO OVERWATCH SIMPLIFIED FLOW for MVP POC</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg border-2 border-dashed border-gray-300">
            <p className="text-gray-500 text-center">
              Place your architecture diagram image in<br />
              <code className="text-sm bg-gray-200 px-2 py-1 rounded mt-2 inline-block">public/diagram.png</code><br />
              <span className="text-xs mt-2 block">Then update the img src below</span>
            </p>
          </div>
          {/* Uncomment and update path when you have a diagram image:
          <img
            src="/diagram.png"
            alt="Architecture Diagram"
            className="w-full h-auto"
          />
          */}
        </div>
        <div className="p-4 border-t bg-gray-50">
          <p className="text-xs text-gray-600">
            Click on any component in the interactive map to see details, add comments, and track progress.
          </p>
        </div>
      </div>
    </div>
  );
}
