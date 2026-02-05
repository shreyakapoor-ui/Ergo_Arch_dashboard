import { useState, useMemo, useEffect, useRef } from "react";
import type {
  ArchitectureData,
  ComponentNode,
  Tag,
} from "./types/architecture";
import { initialArchitectureData } from "./data/initialArchitecture";
import { ArchitectureNode } from "./components/ArchitectureNode";
import { DetailPanel } from "./components/DetailPanel";
import { ArchitectureControls } from "./components/ArchitectureControls";
import { Legend } from "./components/Legend";
import { DiagramViewer } from "./components/DiagramViewer";
import { Button } from "./components/ui/button";
import { Link, Plus, Download, Upload, PlusCircle, RefreshCw, Cloud, CloudOff } from "lucide-react";
import { AddArrowDialog } from "./components/AddArrowDialog";
import { AddNodeDialog } from "./components/AddNodeDialog";

const STORAGE_KEY = "architecture-data";
const CONNECTIONS_KEY = "architecture-connections";

// ===========================================
// CLOUD SYNC CONFIGURATION
// ===========================================
// To enable cloud sync for your team:
// 1. Go to https://jsonbin.io and create a free account
// 2. Create a new bin (paste any JSON like {})
// 3. Copy your Bin ID and API Key
// 4. Set these values below:
const JSONBIN_BIN_ID = "69843022ae596e708f12947b";
const JSONBIN_API_KEY = "$2a$10$FaQ.1qBBMhNc0RD/PPlNVeCtlFiztpq2pjOWCQlzG7SqvZz7s5rk6";

const CLOUD_ENABLED = JSONBIN_BIN_ID && JSONBIN_API_KEY;
// ===========================================

interface CloudData {
  data: ArchitectureData;
  connections: Connection[];
  lastModified: string;
}

// Fetch data from JSONBin
async function fetchCloudData(): Promise<CloudData | null> {
  if (!CLOUD_ENABLED) return null;
  try {
    const response = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`,
      {
        headers: {
          "X-Access-Key": JSONBIN_API_KEY,
        },
      }
    );
    if (response.ok) {
      const result = await response.json();
      return result.record;
    }
  } catch (e) {
    console.error("Failed to fetch cloud data:", e);
  }
  return null;
}

// Save data to JSONBin
async function saveCloudData(cloudData: CloudData): Promise<boolean> {
  if (!CLOUD_ENABLED) return false;
  try {
    const response = await fetch(
      `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Access-Key": JSONBIN_API_KEY,
        },
        body: JSON.stringify(cloudData),
      }
    );
    return response.ok;
  } catch (e) {
    console.error("Failed to save cloud data:", e);
    return false;
  }
}

// Parse dates in loaded data
function parseDates(data: ArchitectureData): ArchitectureData {
  return {
    ...data,
    components: data.components.map((c) => ({
      ...c,
      lastUpdated: new Date(c.lastUpdated),
      comments: c.comments.map((comment) => ({
        ...comment,
        timestamp: new Date(comment.timestamp),
      })),
    })),
    milestones: data.milestones.map((m) => ({
      ...m,
      createdAt: new Date(m.createdAt),
    })),
  };
}

// Load data from localStorage or use initial data
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

interface Connection {
  from: string;
  to: string;
}

export default function App() {
  const [data, setData] = useState<ArchitectureData>(loadLocalData);
  const [selectedNodeId, setSelectedNodeId] = useState<
    string | null
  >(null);
  const [showStatusOverlay, setShowStatusOverlay] =
    useState(true);
  const [activeFilterTags, setActiveFilterTags] = useState<
    string[]
  >([]);
  const [activeMilestone, setActiveMilestone] = useState<
    string | null
  >(null);
  const [showDiagram, setShowDiagram] = useState(false);
  const [connections, setConnections] = useState<Connection[]>(loadLocalConnections);
  const [connectionMode, setConnectionMode] = useState(false);
  const [connectionStart, setConnectionStart] = useState<
    string | null
  >(null);
  const [draggedNode, setDraggedNode] = useState<string | null>(
    null,
  );
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showAddArrow, setShowAddArrow] = useState(false);
  const [showAddNode, setShowAddNode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "synced" | "offline" | "">("");
  const [isLoading, setIsLoading] = useState(CLOUD_ENABLED);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from cloud on startup
  useEffect(() => {
    if (CLOUD_ENABLED) {
      fetchCloudData().then((cloudData) => {
        if (cloudData) {
          setData(parseDates(cloudData.data));
          setConnections(cloudData.connections);
          setSaveStatus("synced");
          setTimeout(() => setSaveStatus(""), 2000);
        }
        setIsLoading(false);
      });
    }
  }, []);

  // Auto-save to localStorage and cloud when data changes
  useEffect(() => {
    if (isLoading) return;

    setSaveStatus("saving");
    const timeout = setTimeout(async () => {
      // Always save to localStorage
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));

      // Save to cloud if enabled
      if (CLOUD_ENABLED) {
        const success = await saveCloudData({
          data,
          connections,
          lastModified: new Date().toISOString(),
        });
        setSaveStatus(success ? "synced" : "offline");
      } else {
        setSaveStatus("saved");
      }
      setTimeout(() => setSaveStatus(""), 2000);
    }, 500);
    return () => clearTimeout(timeout);
  }, [data, connections, isLoading]);

  // Refresh from cloud (manual sync)
  const handleRefresh = async () => {
    if (!CLOUD_ENABLED) return;
    setSaveStatus("saving");
    const cloudData = await fetchCloudData();
    if (cloudData) {
      setData(parseDates(cloudData.data));
      setConnections(cloudData.connections);
      setSaveStatus("synced");
    } else {
      setSaveStatus("offline");
    }
    setTimeout(() => setSaveStatus(""), 2000);
  };

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
          // Convert date strings back to Date objects
          imported.data.components = imported.data.components.map(
            (c: ComponentNode) => ({
              ...c,
              lastUpdated: new Date(c.lastUpdated),
              comments: c.comments.map((comment: any) => ({
                ...comment,
                timestamp: new Date(comment.timestamp),
              })),
            })
          );
          imported.data.milestones = imported.data.milestones.map((m: any) => ({
            ...m,
            createdAt: new Date(m.createdAt),
          }));
          setData(imported.data);
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
    data.components.find((c) => c.id === selectedNodeId) ||
    null;

  const filteredComponents = useMemo(() => {
    let components = data.components;

    if (activeMilestone) {
      const milestone = data.milestones.find(
        (m) => m.id === activeMilestone,
      );
      if (milestone) {
        components = components.filter((comp) =>
          comp.tags.some((tag) =>
            milestone.filterTags.includes(tag),
          ),
        );
      }
    }

    if (activeFilterTags.length > 0) {
      components = components.filter((comp) =>
        activeFilterTags.some((tag) => comp.tags.includes(tag)),
      );
    }

    return components;
  }, [
    data.components,
    activeFilterTags,
    activeMilestone,
    data.milestones,
  ]);

  const handleUpdateNode = (
    nodeId: string,
    updates: Partial<ComponentNode>,
  ) => {
    setData((prev) => ({
      ...prev,
      components: prev.components.map((comp) =>
        comp.id === nodeId
          ? { ...comp, ...updates, lastUpdated: new Date() }
          : comp,
      ),
    }));
  };

  const handleDeleteNode = (nodeId: string) => {
    if (
      window.confirm(
        "Are you sure you want to delete this node? This action cannot be undone.",
      )
    ) {
      setData((prev) => ({
        ...prev,
        components: prev.components.filter(
          (comp) => comp.id !== nodeId,
        ),
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
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId],
    );
  };

  const handleClearFilters = () => {
    setActiveFilterTags([]);
  };

  const handleSelectMilestone = (
    milestoneId: string | null,
  ) => {
    setActiveMilestone(milestoneId);
    setActiveFilterTags([]);
  };

  const handleStartConnection = (nodeId: string) => {
    setConnectionStart(nodeId);
    setConnectionMode(true);
  };

  const handleEndConnection = (nodeId: string) => {
    if (connectionStart && connectionStart !== nodeId) {
      setConnections((prev) => [
        ...prev,
        { from: connectionStart, to: nodeId },
      ]);
    }
    setConnectionMode(false);
    setConnectionStart(null);
  };

  const handleDragStart = (
    nodeId: string,
    e: React.MouseEvent,
  ) => {
    const node = filteredComponents.find(
      (c) => c.id === nodeId,
    );
    if (node) {
      setDraggedNode(nodeId);
      setDragOffset({
        x: e.clientX - node.position.x,
        y: e.clientY - node.position.y,
      });
    }
  };

  const handleDrag = (e: React.MouseEvent) => {
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
            : comp,
        ),
      }));
    }
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
  };

  return (
    <div
      className="min-h-screen bg-gray-50"
      onMouseMove={handleDrag}
      onMouseUp={handleDragEnd}
    >
      <ArchitectureControls
        showStatusOverlay={showStatusOverlay}
        onToggleStatusOverlay={() =>
          setShowStatusOverlay(!showStatusOverlay)
        }
        allTags={data.tags}
        activeFilterTags={activeFilterTags}
        onToggleFilterTag={handleToggleFilterTag}
        onClearFilters={handleClearFilters}
        milestones={data.milestones}
        onSelectMilestone={handleSelectMilestone}
        activeMilestone={activeMilestone}
        onShowDiagram={() => setShowDiagram(true)}
      />

      {/* Connection Mode Banner */}
      {connectionMode && (
        <div className="fixed top-[80px] left-1/2 transform -translate-x-1/2 z-50 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg">
          <p className="text-sm">
            Connection mode active. Click on a target node to
            connect, or press ESC to cancel.
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

      {/* Save Status */}
      {saveStatus && (
        <div className={`fixed top-[80px] right-6 z-50 px-4 py-2 rounded-lg shadow text-sm flex items-center gap-2 ${
          saveStatus === "synced" ? "bg-blue-100 text-blue-800" :
          saveStatus === "offline" ? "bg-yellow-100 text-yellow-800" :
          "bg-green-100 text-green-800"
        }`}>
          {saveStatus === "saving" && <RefreshCw className="h-4 w-4 animate-spin" />}
          {saveStatus === "synced" && <Cloud className="h-4 w-4" />}
          {saveStatus === "offline" && <CloudOff className="h-4 w-4" />}
          {saveStatus === "saved" && "✓"}
          {saveStatus === "saving" ? "Saving..." :
           saveStatus === "synced" ? "Synced to cloud" :
           saveStatus === "offline" ? "Saved locally (cloud offline)" :
           "Saved"}
        </div>
      )}

      {/* Cloud Status Banner */}
      {!CLOUD_ENABLED && (
        <div className="fixed top-[80px] left-1/2 transform -translate-x-1/2 z-40 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-2 rounded-lg shadow text-xs max-w-md text-center">
          Local mode - Set up JSONBin in App.tsx to enable team sync
        </div>
      )}

      {/* Toolbar */}
      <div className="fixed bottom-6 left-6 z-40 flex flex-col gap-2">
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
          {connectionMode
            ? "Cancel Connection"
            : "Connect Nodes"}
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
      <div className="fixed bottom-6 right-6 z-40 flex gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImport}
          accept=".json"
          className="hidden"
        />
        {CLOUD_ENABLED && (
          <Button
            variant="outline"
            size="lg"
            onClick={handleRefresh}
            className="shadow-lg"
            title="Refresh from cloud"
          >
            <RefreshCw className="h-5 w-5 mr-2" />
            Sync
          </Button>
        )}
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
        className="relative"
        style={{
          minHeight: "calc(100vh - 140px)",
          padding: "40px",
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
            const fromNode = filteredComponents.find(
              (c) => c.id === conn.from,
            );
            const toNode = filteredComponents.find(
              (c) => c.id === conn.to,
            );

            if (!fromNode || !toNode) return null;

            // Determine node widths
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

            // Calculate connection points
            const x1 = fromNode.position.x + fromWidth; // center of from node
            const y1 = fromNode.position.y + 70; // bottom of from node
            const x2 = toNode.position.x + toWidth; // center of to node
            const y2 = toNode.position.y; // top of to node

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
                    if (
                      window.confirm("Delete this connection?")
                    ) {
                      setConnections((prev) =>
                        prev.filter((_, i) => i !== idx),
                      );
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
            if (
              connectionMode &&
              e.target === e.currentTarget
            ) {
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

      <Legend />

      <DetailPanel
        node={selectedNode}
        tags={data.tags}
        allTags={data.tags}
        onClose={() => setSelectedNodeId(null)}
        onUpdateNode={handleUpdateNode}
        onDeleteNode={handleDeleteNode}
        onCreateTag={handleCreateTag}
      />

      <DiagramViewer
        isOpen={showDiagram}
        onClose={() => setShowDiagram(false)}
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