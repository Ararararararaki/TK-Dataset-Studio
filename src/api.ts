export type Dataset = {
  id: string;
  name: string;
  path: string;
  count: number;
  completed: number;
  failed: number;
  online: boolean;
};
export type Preset = {
  id: string;
  name: string;
  description: string;
  format: "tags" | "caption" | "hybrid" | "moss";
  pipeline: "wd14" | "wd14-llm" | "llm";
  guidance: string;
  review: boolean;
};
export type Raw = {
  tags?: string[];
  characters?: string[];
  scores?: Record<string, number>;
  model?: string;
  provider?: string;
  elapsed?: number;
};
export type ImageRow = {
  id: string;
  relative: string;
  width: number;
  height: number;
  status: string;
  error: string;
  revision: number;
  format: string;
  updated: number;
};
export type ImageDetail = ImageRow & {
  path: string;
  raw: Raw;
  text: string;
  native: {
    webUrl?: string;
    runId?: string;
    model?: string;
    provider?: string;
    status?: string;
  };
};
export type DshConfig = {
  workspace?: string;
  descriptor: string;
  profile: string;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  agentPreset?: string;
  timeout: number;
};
export type Settings = {
  agent_access: "off" | "read" | "write";
  lookup_characters: boolean;
  character_snapshot: string;
  character_update: boolean;
  lookup_missing: boolean;
  model_dirs: string[];
  wd14: {
    model: string;
    device: string;
    threshold: number;
    character_threshold: number;
    exclude_tags: string;
  };
  dsh: DshConfig;
  overwrite: boolean;
  output_warning: number;
  proxy: string;
  skill_ids: string[];
};
export type Job = {
  id: string;
  state: string;
  dataset_id: string;
  counts: Record<string, number>;
  config: { preset: Preset };
};
export type Ui = {
  presetDrafts?: Record<string, Preset>;
  dataset?: string;
  preset?: string;
  view?: "list" | "grid";
  theme?: "light" | "dark";
  inspector?: boolean;
  assistant?: boolean;
  layout?: Record<string, number>;
  outputHeight?: number;
  scroll?: Record<string, number>;
};
export type Boot = {
  agent: {
    enabled: boolean;
    access: string;
    descriptor: string;
    url: string;
    mcp: { command: string; args: string[] };
  };
  datasets: Dataset[];
  presets: Preset[];
  settings: Settings;
  models: { id: string; name: string; bytes: number }[];
  skills: { id: string; name: string; characters: number }[];
  jobs: Job[];
  ui: Ui;
  data_root: string;
  version: string;
};
export type StudioEvent = {
  kind: string;
  id?: string;
  stage?: string;
  message?: string;
  count?: number;
  bytes?: number;
  total?: number;
  model?: string;
  done?: boolean;
};
type Model = {
  id: string;
  name?: string;
  reasoning?: { efforts: { id: string; label?: string }[] };
};
export type Catalog = {
  workspaces: { workspaceId: string; path: string; title: string }[];
  connected: boolean;
  host_url: string;
  capabilities: {
    models: {
      default: { provider: string; model: string; reasoningEffort?: string };
      groups: { id: string; label?: string; models: Model[] }[];
    };
    presets?: { presets: { id: string; name?: string }[] };
  };
  plugins: { name: string; version: string; status: string }[];
};
declare global {
  interface Window {
    studio: {
      invoke: <T = unknown>(method: string, params?: unknown) => Promise<T>;
      onEvent: (callback: (event: StudioEvent) => void) => () => void;
      onBeforeClose: (callback: () => Promise<void>) => () => void;
      chooseFolder: () => Promise<string | null>;
      chooseFile: () => Promise<string | null>;
      paths: (files: File[]) => string[];
      openExternal: (url: string) => Promise<void>;
      reveal: (id: string) => Promise<void>;
      startDrag: (id: string) => void;
      window: (action: string) => void;
    };
  }
}
export const api = <T = unknown>(method: string, params: unknown = {}) =>
  window.studio.invoke<T>(method, params);
export const imageUrl = (id: string, full = false) =>
  `studio://image/${id}${full ? "?full=1" : ""}`;
export const statusName: Record<string, string> = {
  pending: "待打标",
  running: "处理中",
  done: "已保存",
  external: "已有文本",
  failed: "待重试",
  review: "待复核",
};
