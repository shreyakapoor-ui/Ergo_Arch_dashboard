import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';

interface RoadmapViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RoadmapViewer({ isOpen, onClose }: RoadmapViewerProps) {
  // Close on ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[100]">
      {/* Header with close button */}
      <div className="absolute top-0 left-0 right-0 h-14 bg-white border-b flex items-center justify-between px-4 z-10">
        <h2 className="text-lg font-semibold">Product Roadmap</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Miro iframe - full screen below header */}
      <iframe
        src="https://miro.com/app/live-embed/uXjVGGCJk9Q=/?moveToViewport=-1000,-500,3000,1500&embedMode=view_only_without_ui"
        className="absolute top-14 left-0 right-0 bottom-0 w-full h-[calc(100%-56px)] border-0"
        allow="fullscreen; clipboard-read; clipboard-write"
        title="Product Roadmap - Miro Board"
      />
    </div>
  );
}
