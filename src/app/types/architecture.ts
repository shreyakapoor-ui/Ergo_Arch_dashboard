export type ComponentStatus = 'built' | 'in-progress' | 'planned' | 'open-question';

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface Comment {
  id: string;
  text: string;
  author: string;
  timestamp: Date;
  mentions: string[];
  status: 'open' | 'answered' | 'parked';
}

export interface ComponentNode {
  id: string;
  name: string;
  description: string;
  status: ComponentStatus;
  inputs: string[];
  outputs: string[];
  owner?: string;
  lastUpdated: Date;
  tags: string[]; // tag IDs
  comments: Comment[];
  position: { x: number; y: number };
  layer: number; // for vertical positioning
  workDone?: string;
  inDevelopment?: string;
  blocker?: string;
}

export interface MilestoneView {
  id: string;
  name: string;
  description: string;
  filterTags: string[];
  createdAt: Date;
}

export interface ArchitectureData {
  components: ComponentNode[];
  tags: Tag[];
  milestones: MilestoneView[];
}