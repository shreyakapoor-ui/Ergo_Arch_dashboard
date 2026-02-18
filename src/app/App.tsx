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
import { Link, Plus, Download, Upload, PlusCircle, RefreshCw, LogOut } from "lucide-react";
import { AddArrowDialog } from "./components/AddArrowDialog";
import { AddNodeDialog } from "./components/AddNodeDialog";
import { UnlockScreen } from "./components/UnlockScreen";
import { supabase } from "./supabaseClient";
import { useAuth } from "./auth/useAuth";

// DEBUG flag: append ?debug=1 to URL for verbose save/sync logs
const DEBUG_SAVE = typeof window !== "undefined"
  ? window.location.search.includes("debug=1")
  : false;
const dbg = (...args: unknown[]) => { if (DEBUG_SAVE) console.log("[SAVE-DEBUG]", ...args); };

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
  // ── Dual-gate auth (password + Google OAuth) with inactivity timeout ──────
  const {
    passwordPassed,
    googleUser,
    fullyAuthed,
    loading: authLoading,
    oauthLoading,
    oauthError,
    submitPassword,
    signInWithGoogle,
    logout,
  } = useAuth();

  // Convenience alias used throughout the rest of the file (replaces old isAuthenticated)
  const isAuthenticated = fullyAuthed;

  const [data, setData] = useState<ArchitectureData>(loadLocalData);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const connectionsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);
  const dirtyNodeIdsRef = useRef<Set<string>>(new Set()); // Track which nodes are being edited (for selective merge)
  const lastSaveTimestampRef = useRef<string | null>(null); // Track our last save to dedupe echoes
  const savePendingRef = useRef(false); // True while a debounced save is in-flight
  // Per-node debounce timers for patch saves (nodeId → timeout handle)
  const nodeDebounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

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

  // Echo dedup helper: tolerates small timestamp differences from server normalization
  const isOwnEcho = useCallback((incomingTimestamp: string) => {
    if (!lastSaveTimestampRef.current) return false;
    const diff = Math.abs(
      new Date(incomingTimestamp).getTime() -
      new Date(lastSaveTimestampRef.current).getTime()
    );
    return diff < 100; // 100ms tolerance
  }, []);

  // Write localStorage immediately on every data change (not debounced) — protects against tab close
  useEffect(() => {
    if (isInitialLoad.current) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
  }, [data, connections]);

  // Warn user on tab close if there are unsaved changes (pending node debounce timers)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyNodeIdsRef.current.size > 0 || nodeDebounceTimers.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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
          // Skip if a local save is pending — don't overwrite optimistic state
          if (isPolling && savePendingRef.current) {
            return;
          }

          // Dedupe: skip if this is our own echo (we just saved this)
          if (isOwnEcho(row.updated_at)) {
            console.log("Skipping poll - this is our own echo");
            dbg("POLL skipped (own echo). row.updated_at=", row.updated_at, "lastSave=", lastSaveTimestampRef.current);
            return;
          }
          dbg("Poll applying remote data. updated_at=", row.updated_at,
              "| savePending=", savePendingRef.current,
              "| dirtyNodes=", [...dirtyNodeIdsRef.current]);

          // Only update if data has changed (for polling)
          if (isPolling && row.updated_at === lastUpdatedAt) {
            return; // No changes
          }

          lastUpdatedAt = row.updated_at;

          // Row-level merge: preserve all dirty (being-edited) nodes locally
          const incomingData = parseDates(row.data as ArchitectureData);
          const dirtyIds = dirtyNodeIdsRef.current;

          if (dirtyIds.size > 0) {
            // Merge: keep our local version of dirty nodes, take remote for everything else
            setData(prev => ({
              ...incomingData,
              components: incomingData.components.map(incoming => {
                if (dirtyIds.has(incoming.id)) {
                  const local = prev.components.find(c => c.id === incoming.id);
                  return local || incoming;
                }
                return incoming;
              }),
            }));
          } else {
            // No active edits - safe to replace everything
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

            dbg("Realtime event received. updated_at=", newRow.updated_at,
                "| savePending=", savePendingRef.current,
                "| dirtyNodes=", [...dirtyNodeIdsRef.current]);

            // Skip if a local save is pending — don't overwrite optimistic state
            if (savePendingRef.current) {
              console.log("Skipping realtime — save pending");
              dbg("SKIPPED realtime (save pending)");
              return;
            }

            // Dedupe: skip if this is our own echo
            if (isOwnEcho(newRow.updated_at)) {
              console.log("Skipping realtime - this is our own echo");
              dbg("SKIPPED realtime (own echo). lastSave=", lastSaveTimestampRef.current);
              return;
            }

            dbg("Applying realtime update from another client. dirty=", [...dirtyNodeIdsRef.current]);

            const incomingData = parseDates(newRow.data);
            const dirtyIds = dirtyNodeIdsRef.current;

            if (dirtyIds.size > 0) {
              // Row-level merge: keep our local version of all dirty nodes
              dbg("Merging — preserving dirty nodes:", [...dirtyIds]);
              setData(prev => ({
                ...incomingData,
                components: incomingData.components.map(incoming => {
                  if (dirtyIds.has(incoming.id)) {
                    const local = prev.components.find(c => c.id === incoming.id);
                    return local || incoming;
                  }
                  return incoming;
                }),
              }));
            } else {
              // No active edits - safe to replace everything
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

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH-SEMANTICS SAVE — only the changed node is written to Supabase.
  //
  // Strategy: fetch the current row → merge at component level (last
  // lastUpdated wins per node) → write back.  This means two users editing
  // *different* nodes can never clobber each other.  Two users editing the
  // *same* node at the same time will still race, but the winner is the one
  // whose lastUpdated timestamp is later, which is deterministic.
  // ─────────────────────────────────────────────────────────────────────────
  const patchSaveNode = useCallback(async (nodeId: string, updatedNode: ComponentNode) => {
    if (!isAuthenticated || isInitialLoad.current) return;

    setSaveStatus("saving");
    savePendingRef.current = true;
    dbg("patchSaveNode START", nodeId, updatedNode.lastUpdated);

    let success = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // 1. Fetch the current canonical document from Supabase
        const { data: row, error: fetchErr } = await supabase
          .from("architecture_data")
          .select("data, connections, updated_at")
          .eq("id", "main")
          .single();

        if (fetchErr) {
          console.error(`patchSaveNode fetch attempt ${attempt + 1} failed:`, fetchErr);
          dbg("patchSaveNode fetch error", fetchErr);
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }

        const remote = parseDates(row.data as ArchitectureData);

        // 2. Component-level merge: for each component, keep whichever version
        //    has the later lastUpdated.  Our updated node always wins for itself.
        const mergedComponents = remote.components.map(remoteComp => {
          if (remoteComp.id === nodeId) {
            // Always prefer our local edit for the node we just saved
            return updatedNode;
          }
          return remoteComp;
        });

        // Handle the case where the node doesn't exist in remote yet (new node)
        const exists = remote.components.some(c => c.id === nodeId);
        if (!exists) mergedComponents.push(updatedNode);

        const saveTimestamp = new Date().toISOString();
        lastSaveTimestampRef.current = saveTimestamp;

        const mergedData: ArchitectureData = {
          ...remote,
          components: mergedComponents,
        };

        dbg("patchSaveNode writing merge. nodeId=", nodeId,
            "remote components=", remote.components.length,
            "merged components=", mergedComponents.length,
            "ts=", saveTimestamp);

        // 3. Write the merged document back
        const { error: writeErr } = await supabase
          .from("architecture_data")
          .upsert({
            id: "main",
            data: mergedData,
            connections: row.connections,  // preserve connections as-is
            updated_at: saveTimestamp,
          });

        if (!writeErr) {
          success = true;
          // Keep local state in sync with what we actually persisted
          setData(prev => ({
            ...prev,
            components: prev.components.map(c =>
              c.id === nodeId ? updatedNode : c
            ),
          }));
          dbg("patchSaveNode succeeded attempt", attempt + 1);
          break;
        }

        console.error(`patchSaveNode write attempt ${attempt + 1} failed:`, writeErr);
        dbg("patchSaveNode write error", writeErr);
      } catch (e) {
        console.error(`patchSaveNode attempt ${attempt + 1} threw:`, e);
        dbg("patchSaveNode threw", e);
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }

    savePendingRef.current = false;
    setSaveStatus(success ? "synced" : "offline");
    dbg("patchSaveNode DONE. success=", success);
    setTimeout(() => setSaveStatus(""), 2000);
  }, [isAuthenticated]);

  // Connections-only save (connections change rarely — add/delete arrow).
  // Still a full-doc write but connections are never edited concurrently with
  // node fields, so the race window is negligible.
  const saveConnections = useCallback(async (newConnections: Connection[]) => {
    if (!isAuthenticated || isInitialLoad.current) return;

    dbg("saveConnections START, count=", newConnections.length);
    setSaveStatus("saving");

    try {
      const { data: row, error: fetchErr } = await supabase
        .from("architecture_data")
        .select("data, updated_at")
        .eq("id", "main")
        .single();

      if (fetchErr) { console.error("saveConnections fetch failed:", fetchErr); return; }

      const saveTimestamp = new Date().toISOString();
      lastSaveTimestampRef.current = saveTimestamp;

      const { error } = await supabase
        .from("architecture_data")
        .upsert({
          id: "main",
          data: row.data,           // preserve node data as-is
          connections: newConnections,
          updated_at: saveTimestamp,
        });

      setSaveStatus(error ? "offline" : "synced");
      dbg("saveConnections done. error=", error);
    } catch (e) {
      console.error("saveConnections threw:", e);
      setSaveStatus("offline");
    }
    setTimeout(() => setSaveStatus(""), 2000);
  }, [isAuthenticated]);

  // Debounced connections save — fires 800 ms after the last connection change
  useEffect(() => {
    if (!isAuthenticated || isInitialLoad.current) return;
    if (connectionsSaveTimeoutRef.current) clearTimeout(connectionsSaveTimeoutRef.current);
    connectionsSaveTimeoutRef.current = setTimeout(() => {
      saveConnections(connections);
    }, 800);
    return () => {
      if (connectionsSaveTimeoutRef.current) clearTimeout(connectionsSaveTimeoutRef.current);
    };
  }, [connections, isAuthenticated, saveConnections]);

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

  // Add new node — immediately patch-save it (no debounce needed, only fires once)
  const handleAddNode = useCallback((node: ComponentNode) => {
    setData((prev) => {
      const updated = { ...prev, components: [...prev.components, node] };
      // Save only the new node via patch (patchSaveNode handles "not exists in remote" case)
      patchSaveNode(node.id, node);
      return updated;
    });
  }, [patchSaveNode]);

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

  // Optimistically update local state, then debounce a patch-save for just this node.
  // Each node gets its own 800 ms debounce timer so rapid keystrokes collapse into
  // a single network round-trip per node, and two users editing different nodes
  // never touch each other's data.
  const handleUpdateNode = useCallback((nodeId: string, updates: Partial<ComponentNode>): void => {
    // Build the merged node immediately so we can capture it in the debounce closure
    setData((prev) => {
      const updatedComponents = prev.components.map((comp) =>
        comp.id === nodeId
          ? { ...comp, ...updates, lastUpdated: new Date() }
          : comp
      );

      const updatedNode = updatedComponents.find(c => c.id === nodeId);
      if (!updatedNode) return { ...prev, components: updatedComponents };

      // Cancel any in-flight debounce for this specific node
      const existing = nodeDebounceTimers.current.get(nodeId);
      if (existing) clearTimeout(existing);

      // Schedule patch-save for this node only
      const timer = setTimeout(() => {
        nodeDebounceTimers.current.delete(nodeId);
        patchSaveNode(nodeId, updatedNode);
      }, 800);
      nodeDebounceTimers.current.set(nodeId, timer);

      return { ...prev, components: updatedComponents };
    });
  }, [patchSaveNode]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    if (
      window.confirm(
        "Are you sure you want to delete this node? This action cannot be undone."
      )
    ) {
      setData((prev) => {
        const updated = {
          ...prev,
          components: prev.components.filter((comp) => comp.id !== nodeId),
        };
        // Persist deletion: fetch remote, remove the node, write back
        (async () => {
          try {
            setSaveStatus("saving");
            const { data: row, error: fetchErr } = await supabase
              .from("architecture_data")
              .select("data, connections, updated_at")
              .eq("id", "main")
              .single();
            if (fetchErr) { console.error("delete fetch failed:", fetchErr); return; }
            const remote = parseDates(row.data as ArchitectureData);
            const saveTimestamp = new Date().toISOString();
            lastSaveTimestampRef.current = saveTimestamp;
            const { error } = await supabase
              .from("architecture_data")
              .upsert({
                id: "main",
                data: { ...remote, components: remote.components.filter(c => c.id !== nodeId) },
                connections: row.connections,
                updated_at: saveTimestamp,
              });
            setSaveStatus(error ? "offline" : "synced");
            dbg("delete node", nodeId, "error=", error);
          } catch (e) {
            console.error("delete node save threw:", e);
            setSaveStatus("offline");
          }
          setTimeout(() => setSaveStatus(""), 2000);
        })();
        return updated;
      });
      setSelectedNodeId(null);
    }
  }, []);

  const handleCreateTag = useCallback((label: string, color: string) => {
    const newTag: Tag = {
      id: label.toLowerCase().replace(/\s+/g, "-"),
      label,
      color,
    };
    setData((prev) => {
      const updated = { ...prev, tags: [...prev.tags, newTag] };
      // Persist: fetch remote, append tag (dedup by id), write back
      (async () => {
        try {
          setSaveStatus("saving");
          const { data: row, error: fetchErr } = await supabase
            .from("architecture_data")
            .select("data, connections, updated_at")
            .eq("id", "main")
            .single();
          if (fetchErr) { console.error("createTag fetch failed:", fetchErr); return; }
          const remote = parseDates(row.data as ArchitectureData);
          const existingIds = new Set(remote.tags.map((t: Tag) => t.id));
          const mergedTags = existingIds.has(newTag.id)
            ? remote.tags
            : [...remote.tags, newTag];
          const saveTimestamp = new Date().toISOString();
          lastSaveTimestampRef.current = saveTimestamp;
          const { error } = await supabase
            .from("architecture_data")
            .upsert({
              id: "main",
              data: { ...remote, tags: mergedTags },
              connections: row.connections,
              updated_at: saveTimestamp,
            });
          setSaveStatus(error ? "offline" : "synced");
          dbg("createTag", newTag.id, "error=", error);
        } catch (e) {
          console.error("createTag save threw:", e);
          setSaveStatus("offline");
        }
        setTimeout(() => setSaveStatus(""), 2000);
      })();
      return updated;
    });
  }, []);

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
      const nodeId = draggedNode;
      setData((prev) => {
        const updatedComponents = prev.components.map((comp) =>
          comp.id === nodeId
            ? {
                ...comp,
                position: {
                  x: e.clientX - dragOffset.x,
                  y: e.clientY - dragOffset.y,
                },
              }
            : comp
        );

        const updatedNode = updatedComponents.find(c => c.id === nodeId);
        if (!updatedNode) return { ...prev, components: updatedComponents };

        // Debounce position patch-save (1 s — drag fires on every mousemove)
        const existing = nodeDebounceTimers.current.get(`drag-${nodeId}`);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          nodeDebounceTimers.current.delete(`drag-${nodeId}`);
          patchSaveNode(nodeId, updatedNode);
        }, 1000);
        nodeDebounceTimers.current.set(`drag-${nodeId}`, timer);

        return { ...prev, components: updatedComponents };
      });
    }
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
  };

  // While Supabase resolves the existing OAuth session, show nothing (avoids flash)
  if (authLoading) return null;

  // Show unlock screen until both gates are satisfied
  if (!fullyAuthed) {
    return (
      <UnlockScreen
        passwordPassed={passwordPassed}
        googleUser={googleUser}
        oauthLoading={oauthLoading}
        oauthError={oauthError}
        submitPassword={submitPassword}
        signInWithGoogle={signInWithGoogle}
        onEnter={() => {
          // fullyAuthed is already true at this point; onEnter just forces
          // a re-render so the main app mounts immediately on button click.
          // No additional state needed — useAuth drives everything.
        }}
      />
    );
  }

  return (
    <div
      className="min-h-screen bg-gray-50 overflow-x-hidden"
      onMouseMove={handleDrag}
      onMouseUp={handleDragEnd}
    >
      <ArchitectureControls
        allTags={data.tags}
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


      {/* Toolbar - left side */}
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

        {/* ── Logout ── */}
        <div className="border-t border-gray-200 pt-2 mt-1">
          {googleUser && (
            <p className="text-[10px] text-gray-400 text-center mb-1 truncate px-1 max-w-[160px]">
              {googleUser.user_metadata?.full_name ?? googleUser.email}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="w-full text-gray-500 hover:text-red-600 hover:bg-red-50 gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
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
              showStatusOverlay={true}
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
        onEditStart={(nodeId) => { dirtyNodeIdsRef.current.add(nodeId); }}
        onEditEnd={(nodeId) => { if (nodeId) dirtyNodeIdsRef.current.delete(nodeId); }}
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
