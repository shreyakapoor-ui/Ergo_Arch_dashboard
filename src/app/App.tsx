import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import type {
  ArchitectureData,
  ComponentNode,
  Tag,
} from "./types/architecture";
import { initialArchitectureData } from "./data/initialArchitecture";
import { ArchitectureNode } from "./components/ArchitectureNode";
import { DetailPanel } from "./components/DetailPanel";
import { ArchitectureControls } from "./components/ArchitectureControls";
import { DiagramViewer } from "./components/DiagramViewer";
import { RoadmapViewer } from "./components/RoadmapViewer";
import { Button } from "./components/ui/button";
import { Link, Plus, Download, Upload, PlusCircle, RefreshCw, Cloud, CloudOff, Users } from "lucide-react";
import { AddArrowDialog } from "./components/AddArrowDialog";
import { AddNodeDialog } from "./components/AddNodeDialog";
import { PasswordGate } from "./components/PasswordGate";
import { createClient } from "@supabase/supabase-js";

// ===========================================
// SUPABASE CONFIGURATION (Real-time sync)
// ===========================================
const SUPABASE_URL = "https://ywnvnwsziqjhauyqgzjt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3bnZud3N6aXFqaGF1eXFnemp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNjUxODQsImV4cCI6MjA4NTg0MTE4NH0.VqANIUQSYsyAwTSZUIq7K_xFdd00iG0wiIT8U8bV_9o";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ===========================================

const STORAGE_KEY = "architecture-data";
const CONNECTIONS_KEY = "architecture-connections";

interface Connection {
  from: string;
  to: string;
}

// Parse dates in loaded data
function parseDates(data: ArchitectureData): ArchitectureData {
  if (!data || !data.components) return initialArchitectureData;
  return {
    ...data,
    components: data.components.map((c) => ({
      ...c,
      lastUpdated: new Date(c.lastUpdated),
      comments: c.comments?.map((comment) => ({
        ...comment,
        timestamp: new Date(comment.timestamp),
      })) || [],
    })),
    milestones: data.milestones?.map((m) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    })) || [],
    tags: data.tags || [],
  };
}

// Load data from localStorage as fallback
function loadLocalData(): ArchitectureData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return parseDates(JSON.parse(saved));
    }
  } catch (e) {
    console.error("Failed to load saved data:", e);
  }
  return initialArchitectureData;
}

function loadLocalConnections(): Connection[] {
  try {
    const saved = localStorage.getItem(CONNECTIONS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error("Failed to load connections:", e);
  }
  return [
    { from: "company-profile", to: "data-loader" },
    { from: "predefined-scenarios", to: "data-loader" },
    { from: "data-loader", to: "scenario-bundles" },
    { from: "scenario-bundles", to: "flos-analysis" },
    { from: "flos-analysis", to: "finance-agent" },
    { from: "flos-analysis", to: "legal-agent" },
    { from: "flos-analysis", to: "operations-agent" },
    { from: "flos-analysis", to: "strategy-agent" },
    { from: "finance-agent", to: "all-items-combined" },
    { from: "legal-agent", to: "all-items-combined" },
    { from: "operations-agent", to: "all-items-combined" },
    { from: "strategy-agent", to: "all-items-combined" },
    { from: "all-items-combined", to: "policy-checker" },
    { from: "policy-checker", to: "json-output" },
  ];
}

export default function App() {
  // Check if already authenticated
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('arch-authenticated') === 'true';
  });

  const [data, setData] = useState<ArchitectureData>(loadLocalData);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showStatusOverlay, setShowStatusOverlay] = useState(true);
  const [activeFilterTags, setActiveFilterTags] = useState<string[]>([]);
  const [activeMilestone, setActiveMilestone] = useState<string | null>(null);
  const [showDiagram, setShowDiagram] = useState(false);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [connections, setConnections] = useState<Connection[]>(loadLocalConnections);
  const [connectionMode, setConnectionMode] = useState(false);
  const [connectionStart, setConnectionStart] = useState<string | null>(null);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showAddArrow, setShowAddArrow] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "synced" | "offline" | "realtime" | "">("");
  const [isLoading, setIsLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);
  const editingNodeIdRef = useRef<string | null>(null); // Track which node is being edited (for selective merge)
  const lastSaveTimestampRef = useRef<string | null>(null); // Track our last save to dedupe echoes
  const pendingSaveResolvers = useRef<Array<{ resolve: () => void; reject: (e: Error) => void }>>([]); // Track pending save promises

  // ===== Resizable Detail Panel state =====
  const PANEL_MIN_WIDTH = 320;
  const PANEL_MAX_WIDTH_PERCENT = 0.8;
  const [panelWidth, setPanelWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(500);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = panelWidth;
  }, [panelWidth]);

  // Global mousemove/mouseup for resize (attached to window so drag works outside component)
  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent) => {
      const maxWidth = window.innerWidth * PANEL_MAX_WIDTH_PERCENT;
      const delta = resizeStartX.current - e.clientX; // dragging left = wider panel
      const newWidth = Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, resizeStartWidth.current + delta));
      setPanelWidth(newWidth);
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    // Set global cursor style so it stays col-resize even when mouse leaves the handle
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }, [isResizing]);

  // Load from Supabase on startup + subscribe to real-time updates
  useEffect(() => {
    // Skip if not authenticated
    if (!isAuthenticated) return;

    let lastUpdatedAt: string | null = null;

    // Fetch initial data
    const fetchData = async (isPolling = false) => {
      try {
        const { data: row, error } = await supabase
          .from("architecture_data")
          .select("*")
          .eq("id", "main")
          .single();

        if (error) {
          console.error("Supabase fetch error:", error);
          if (!isPolling) setIsLoading(false);
          return;
        }

        if (row && row.data && Object.keys(row.data).length > 0) {
          // Dedupe: skip if this is our own echo (we just saved this)
          if (row.updated_at === lastSaveTimestampRef.current) {
            console.log("Skipping poll - this is our own echo");
            return;
          }

          // Only update if data has changed (for polling)
          if (isPolling && row.updated_at === lastUpdatedAt) {
            return; // No changes
          }

          lastUpdatedAt = row.updated_at;

          // Row-level merge: preserve the node being edited locally
          const incomingData = parseDates(row.data as ArchitectureData);
          const editingId = editingNodeIdRef.current;

          if (editingId) {
            // Merge: keep our local version of the editing node, take remote for everything else
            setData(prev => ({
              ...incomingData,
              components: incomingData.components.map(incoming => {
                if (incoming.id === editingId) {
                  // Keep our local version of this node
                  const local = prev.components.find(c => c.id === editingId);
                  return local || incoming;
                }
                return incoming;
              }),
            }));
          } else {
            // No active edit - safe to replace everything
            setData(incomingData);
          }

          setConnections(row.connections as Connection[] || loadLocalConnections());

          if (isPolling) {
            setSaveStatus("realtime");
            setTimeout(() => setSaveStatus(""), 2000);
          } else {
            setSaveStatus("synced");
          }
        } else {
          // First time - save initial data to Supabase
          await supabase
            .from("architecture_data")
            .upsert({
              id: "main",
              data: initialArchitectureData,
              connections: loadLocalConnections(),
              updated_at: new Date().toISOString(),
            });
        }
      } catch (e) {
        console.error("Failed to fetch from Supabase:", e);
      }
      if (!isPolling) {
        setIsLoading(false);
        isInitialLoad.current = false;
      }
    };

    fetchData();

    // Subscribe to real-time changes
    const channel = supabase
      .channel("architecture_changes")
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all events: INSERT, UPDATE, DELETE
          schema: "public",
          table: "architecture_data",
        },
        (payload) => {
          console.log("Real-time update received:", payload);

          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            const newRow = payload.new as { data: ArchitectureData; connections: Connection[]; updated_at: string };

            // Dedupe: skip if this is our own echo
            if (newRow.updated_at === lastSaveTimestampRef.current) {
              console.log("Skipping realtime - this is our own echo");
              return;
            }

            const incomingData = parseDates(newRow.data);
            const editingId = editingNodeIdRef.current;

            if (editingId) {
              // Row-level merge: keep our local version of the editing node
              setData(prev => ({
                ...incomingData,
                components: incomingData.components.map(incoming => {
                  if (incoming.id === editingId) {
                    const local = prev.components.find(c => c.id === editingId);
                    return local || incoming;
                  }
                  return incoming;
                }),
              }));
            } else {
              // No active edit - safe to replace everything
              setData(incomingData);
            }

            if (newRow.connections) {
              setConnections(newRow.connections);
            }
            setSaveStatus("realtime");
            setTimeout(() => setSaveStatus(""), 2000);
          }
        }
      )
      .subscribe((status) => {
        console.log("Realtime subscription status:", status);
        if (status === "SUBSCRIBED") {
          console.log("✅ Real-time is connected!");
        }
      });

    // Polling fallback - check for updates every 3 seconds
    // This ensures sync even if realtime websocket has issues
    const pollInterval = setInterval(() => {
      fetchData(true);
    }, 3000);

    // Cleanup
    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollInterval);
    };
  }, [isAuthenticated]);

  // Auto-save to Supabase when data changes (debounced)
  useEffect(() => {
    if (!isAuthenticated || isLoading || isInitialLoad.current) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setSaveStatus("saving");

    // Debounce saves to avoid too many requests
    saveTimeoutRef.current = setTimeout(async () => {
      // Save to localStorage as backup
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));

      // Generate timestamp for echo deduplication
      const saveTimestamp = new Date().toISOString();
      lastSaveTimestampRef.current = saveTimestamp;

      // Save to Supabase
      try {
        const { error } = await supabase
          .from("architecture_data")
          .upsert({
            id: "main",
            data: data,
            connections: connections,
            updated_at: saveTimestamp,
          });

        if (error) {
          console.error("Supabase save error:", error);
          setSaveStatus("offline");
          // Reject all pending save promises
          pendingSaveResolvers.current.forEach(({ reject }) => reject(new Error("Save failed")));
          pendingSaveResolvers.current = [];
        } else {
          setSaveStatus("synced");
          // Resolve all pending save promises
          pendingSaveResolvers.current.forEach(({ resolve }) => resolve());
          pendingSaveResolvers.current = [];
        }
      } catch (e) {
        console.error("Failed to save to Supabase:", e);
        setSaveStatus("offline");
        // Reject all pending save promises
        pendingSaveResolvers.current.forEach(({ reject }) => reject(e as Error));
        pendingSaveResolvers.current = [];
      }
      setTimeout(() => setSaveStatus(""), 2000);
    }, 800);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, connections, isLoading]);

  // Export data as JSON file
  const handleExport = () => {
    const exportData = {
      data,
      connections,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `architecture-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import data from JSON file
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported.data && imported.connections) {
          setData(parseDates(imported.data));
          setConnections(imported.connections);
          alert("Data imported successfully!");
        } else {
          alert("Invalid file format");
        }
      } catch (err) {
        alert("Failed to import file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Add new node
  const handleAddNode = (node: ComponentNode) => {
    setData((prev) => ({
      ...prev,
      components: [...prev.components, node],
    }));
  };

  const selectedNode =
    data.components.find((c) => c.id === selectedNodeId) || null;

  const filteredComponents = useMemo(() => {
    let components = data.components;

    if (activeMilestone) {
      const milestone = data.milestones.find((m) => m.id === activeMilestone);
      if (milestone) {
        components = components.filter((comp) =>
          comp.tags.some((tag) => milestone.filterTags.includes(tag))
        );
      }
    }

    if (activeFilterTags.length > 0) {
      components = components.filter((comp) =>
        activeFilterTags.some((tag) => comp.tags.includes(tag))
      );
    }

    return components;
  }, [data.components, activeFilterTags, activeMilestone, data.milestones]);

  // Returns a promise that resolves when the save completes
  const handleUpdateNode = (nodeId: string, updates: Partial<ComponentNode>): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Track this promise to resolve when save completes
      pendingSaveResolvers.current.push({ resolve, reject });

      // Optimistically update local state immediately
      setData((prev) => ({
        ...prev,
        components: prev.components.map((comp) =>
          comp.id === nodeId
            ? { ...comp, ...updates, lastUpdated: new Date() }
            : comp
        ),
      }));
    });
  };

  const handleDeleteNode = (nodeId: string) => {
    if (
      window.confirm(
        "Are you sure you want to delete this node? This action cannot be undone."
      )
    ) {
      setData((prev) => ({
        ...prev,
        components: prev.components.filter((comp) => comp.id !== nodeId),
      }));
      setSelectedNodeId(null);
    }
  };

  const handleCreateTag = (label: string, color: string) => {
    const newTag: Tag = {
      id: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      color,
    };
    setData((prev) => ({
      ...prev,
      tags: [...prev.tags, newTag],
    }));
  };

  const handleToggleFilterTag = (tagId: string) => {
    setActiveFilterTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const handleClearFilters = () => {
    setActiveFilterTags([]);
  };

  const handleSelectMilestone = (milestoneId: string | null) => {
    setActiveMilestone(milestoneId);
    setActiveFilterTags([]);
  };

  const handleStartConnection = (nodeId: string) => {
    setConnectionStart(nodeId);
    setConnectionMode(true);
  };

  const handleEndConnection = (nodeId: string) => {
    if (connectionStart && connectionStart !== nodeId) {
      setConnections((prev) => [...prev, { from: connectionStart, to: nodeId }]);
    }
    setConnectionMode(false);
    setConnectionStart(null);
  };

  const handleDragStart = (nodeId: string, e: React.MouseEvent) => {
    const node = filteredComponents.find((c) => c.id === nodeId);
    if (node) {
      setDraggedNode(nodeId);
      setDragOffset({
        x: e.clientX - node.position.x,
        y: e.clientY - node.position.y,
      });
    }
  };

  const handleDrag = (e: React.MouseEvent) => {
    if (isResizing) return; // Don't drag nodes while resizing the panel
    if (draggedNode) {
      setData((prev) => ({
        ...prev,
        components: prev.components.map((comp) =>
          comp.id === draggedNode
            ? {
                ...comp,
                position: {
                  x: e.clientX - dragOffset.x,
                  y: e.clientY - dragOffset.y,
                },
              }
            : comp
        ),
      }));
    }
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
  };

  // Show password gate if not authenticated
  if (!isAuthenticated) {
    return <PasswordGate onSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div
      className="min-h-screen bg-gray-50 overflow-x-hidden"
      onMouseMove={handleDrag}
      onMouseUp={handleDragEnd}
    >
      <ArchitectureControls
        showStatusOverlay={showStatusOverlay}
        onToggleStatusOverlay={() => setShowStatusOverlay(!showStatusOverlay)}
        allTags={data.tags}
        activeFilterTags={activeFilterTags}
        onToggleFilterTag={handleToggleFilterTag}
        onClearFilters={handleClearFilters}
        milestones={data.milestones}
        onSelectMilestone={handleSelectMilestone}
        activeMilestone={activeMilestone}
        onShowDiagram={() => setShowDiagram(true)}
        onShowRoadmap={() => setShowRoadmap(true)}
      />

      {/* Connection Mode Banner */}
      {connectionMode && (
        <div className="fixed top-[80px] left-1/2 transform -translate-x-1/2 z-50 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg">
          <p className="text-sm">
            Connection mode active. Click on a target node to connect, or press
            ESC to cancel.
          </p>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 bg-white/80 z-[200] flex items-center justify-center">
          <div className="text-center">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-600" />
            <p className="text-gray-600">Loading from cloud...</p>
          </div>
        </div>
      )}


      {/* Toolbar - moved to left side, higher up to not overlap with anything */}
      <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-2 bg-white/90 p-2 rounded-lg shadow-lg">
        <Button
          variant="default"
          size="lg"
          onClick={() => setShowAddNode(true)}
          className="shadow-lg bg-green-600 hover:bg-green-700"
        >
          <PlusCircle className="h-5 w-5 mr-2" />
          Add Node
        </Button>
        <Button
          variant={connectionMode ? "default" : "outline"}
          size="lg"
          onClick={() => {
            setConnectionMode(!connectionMode);
            setConnectionStart(null);
          }}
          className="shadow-lg"
        >
          <Link className="h-5 w-5 mr-2" />
          {connectionMode ? "Cancel Connection" : "Connect Nodes"}
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={() => setShowAddArrow(true)}
          className="shadow-lg"
        >
          <Plus className="h-5 w-5 mr-2" />
          Add Arrow
        </Button>
      </div>

      {/* Export/Import Toolbar */}
      <div
        className="fixed bottom-6 z-40 flex gap-2 transition-[right] duration-100 ease-out"
        style={{ right: selectedNode ? `${panelWidth + 24}px` : '24px' }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          accept=".json"
          className="hidden"
        />
        <Button
          variant="outline"
          size="lg"
          onClick={() => fileInputRef.current?.click()}
          className="shadow-lg"
        >
          <Upload className="h-5 w-5 mr-2" />
          Import
        </Button>
        <Button
          variant="outline"
          size="lg"
          onClick={handleExport}
          className="shadow-lg"
        >
          <Download className="h-5 w-5 mr-2" />
          Export
        </Button>
      </div>

      <div
        className="relative transition-[margin] duration-100 ease-out"
        style={{
          minHeight: "calc(100vh - 140px)",
          padding: "40px",
          marginRight: selectedNode ? `${panelWidth}px` : "0px",
          userSelect: isResizing ? "none" : undefined,
        }}
      >
        {/* Flow Layer - Arrows */}
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: "100%",
            height: "1400px",
            zIndex: 5,
          }}
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon points="0 0, 8 4, 0 8" fill="#374151" />
            </marker>
          </defs>
          {connections.map((conn, idx) => {
            const fromNode = filteredComponents.find((c) => c.id === conn.from);
            const toNode = filteredComponents.find((c) => c.id === conn.to);

            if (!fromNode || !toNode) return null;

            const isFromAgentNode = [
              "finance-agent",
              "legal-agent",
              "operations-agent",
              "strategy-agent",
            ].includes(fromNode.id);
            const isToAgentNode = [
              "finance-agent",
              "legal-agent",
              "operations-agent",
              "strategy-agent",
            ].includes(toNode.id);
            const fromWidth = isFromAgentNode ? 80 : 110;
            const toWidth = isToAgentNode ? 80 : 110;

            const x1 = fromNode.position.x + fromWidth;
            const y1 = fromNode.position.y + 70;
            const x2 = toNode.position.x + toWidth;
            const y2 = toNode.position.y;

            return (
              <g key={idx}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#374151"
                  strokeWidth="2"
                  markerEnd="url(#arrowhead)"
                  className="pointer-events-auto cursor-pointer hover:stroke-red-500"
                  onClick={() => {
                    if (window.confirm("Delete this connection?")) {
                      setConnections((prev) => prev.filter((_, i) => i !== idx));
                    }
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* Node Layer */}
        <div
          className="relative"
          style={{ zIndex: 10, minHeight: "1200px" }}
          onClick={(e) => {
            if (connectionMode && e.target === e.currentTarget) {
              setConnectionMode(false);
              setConnectionStart(null);
            }
          }}
        >
          {filteredComponents.map((node) => (
            <ArchitectureNode
              key={node.id}
              node={node}
              tags={data.tags}
              onClick={() => {
                if (connectionMode) {
                  if (connectionStart) {
                    handleEndConnection(node.id);
                  } else {
                    handleStartConnection(node.id);
                  }
                } else {
                  setSelectedNodeId(node.id);
                }
              }}
              showStatusOverlay={showStatusOverlay}
              onDragStart={(e) => handleDragStart(node.id, e)}
              connectionMode={connectionMode}
              isConnectionStart={connectionStart === node.id}
            />
          ))}
        </div>
      </div>


      <DetailPanel
        node={selectedNode}
        tags={data.tags}
        allTags={data.tags}
        onClose={() => setSelectedNodeId(null)}
        onUpdateNode={handleUpdateNode}
        onDeleteNode={handleDeleteNode}
        onCreateTag={handleCreateTag}
        onEditStart={(nodeId) => { editingNodeIdRef.current = nodeId; }}
        onEditEnd={() => { editingNodeIdRef.current = null; }}
        width={panelWidth}
        onResizeStart={handleResizeStart}
        isResizing={isResizing}
      />

      <DiagramViewer
        isOpen={showDiagram}
        onClose={() => setShowDiagram(false)}
      />

      <RoadmapViewer
        isOpen={showRoadmap}
        onClose={() => setShowRoadmap(false)}
      />

      <AddArrowDialog
        isOpen={showAddArrow}
        onClose={() => setShowAddArrow(false)}
        onAddArrow={(from, to) => {
          setConnections((prev) => [...prev, { from, to }]);
          setShowAddArrow(false);
        }}
        nodes={filteredComponents.map((node) => node.id)}
      />

      <AddNodeDialog
        isOpen={showAddNode}
        onClose={() => setShowAddNode(false)}
        onAddNode={(node) => {
          handleAddNode(node);
          setShowAddNode(false);
        }}
        existingTags={data.tags}
      />
    </div>
  );
}
