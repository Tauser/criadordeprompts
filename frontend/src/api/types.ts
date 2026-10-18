// Mirrors backend/src/prisma_studio/domain/request.py (contract v1). Keep both in sync; /api/contract exposes the schema.
export const CATEGORIES = ['subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
  'expression', 'action', 'lighting', 'style', 'camera', 'framing'] as const;
export type Category = typeof CATEGORIES[number];
export type Intent = 'keep' | 'set' | 'transfer' | 'free';
export type Support = 'floor' | 'seat' | 'bed' | 'wall' | 'table';
export type Framing = 'portrait' | 'half' | 'full' | 'wide';
export type Posture = 'standing' | 'seated' | 'kneeling' | 'all_fours' | 'squatting' | 'lying' | 'supine' | 'prone'
  | 'side_lying' | 'walking' | 'running' | 'any';
export type Orientation = 'front' | 'back' | 'side' | 'three_quarter' | 'any';
export type Gaze = 'camera' | 'away' | 'down' | 'up' | 'back' | 'closed' | 'any';

export type Value = {kind: 'catalog'; item_id: string} | {kind: 'text'; text: string};
export interface Attribute {intent: Intent; value?: Value; reference_id?: string}
export interface Reference {id: string; label: string}
export interface Character {reference_id: string; description: string}

export interface Output {
  profile: 'qwen21' | 'turbo';
  resolution: 0 | 1024 | 1536 | 2048;
  aspect: '3:4' | '2:3' | '1:1' | '16:9' | '9:16' | '4:3' | '3:2';
  width?: number | null;
  height?: number | null;
  seed?: number | null;
  variations: number;
  verify: boolean;
  refine: boolean;
}

export interface Engine {
  steps?: number | null; cfg?: number | null; sampler?: string | null; scheduler?: string | null;
  denoise?: number | null; negative_prompt: string;
}

export interface StudioRequest {
  schema_version: 1;
  mode: 'generate' | 'edit';
  content_mode: 'standard' | 'adult';
  prompt_mode: 'structured' | 'manual';
  manual_prompt?: string | null;
  attributes: Partial<Record<Category, Attribute>>;
  wardrobe_scope?: 'primary' | 'all';
  references: Reference[];
  target_id?: string | null;
  mask: boolean;
  characters?: Character[];
  participants: {requested?: number | null; existing?: number | null};
  context: {supports?: Support[] | null; allow_new_supports: boolean; allow_reframing: boolean; original_framing?: Framing | null};
  details: string;
  confirmations: ('adults_only' | 'consent_or_fictional')[];
  output: Output;
  engine: Engine;
}

export interface Requirements {
  participants?: number | null; posture?: Posture | null; gaze?: Gaze | null; orientation?: Orientation | null;
  support_any_of?: Support[] | null; minimum_framing?: Framing | null;
}
export interface Item {
  id: string; category: Category; label: string; prompt: string; prompt_pt?: string | null; edit_prompt?: string | null;
  adult: boolean; enabled: boolean; requirements: Requirements;
  provides: {supports?: Support[] | null; framing?: Framing | null};
}
export interface LibrarySnapshot {revision: number; items: Item[]; origins: Record<string, 'builtin' | 'user' | 'custom'>}

export interface Issue {code: string; level: 'error' | 'warning' | 'unknown'; kind: 'product' | 'model' | 'policy'; field: string; message: string}
export interface Prepared {
  valid: boolean; status: string; issues: Issue[]; slots: Record<string, number>; prompt: string | null;
  segments: {block: string; text: string}[]; checks: {id: string; question: string}[];
}

export interface Verdict {verdict: 'met' | 'partial' | 'unmet' | 'unknown'; note: string}
export interface RunImage {task_id: string; position: number; seed: number; status: string; files: string[];
  score?: number | null; verdicts?: Record<string, Verdict> | null}
export interface Task {id: string; kind: string; position: number; status: string; seed?: number | null;
  comfy_prompt_id?: string | null; error?: string | null; submitted_at?: number | null; started_at?: number | null;
  ended_at?: number | null; timings?: {phases: Record<string, number>} | null;
  live?: {phase: string | null; node_class: string | null; value: number | null; maximum: number | null; since: number | null}}
export interface RunEvent {id: number; at: number; type: string; [key: string]: unknown}
export interface Run {
  id: string; request_id: string; status: string; mode: string; prompt: string | null; effective_prompt: string | null;
  refined_prompt: string | null; error: string | null; best_task_id: string | null; cancel_requested: boolean;
  created_at: number; updated_at: number;
  settings: {profile: string; resolution: number; width?: number; height?: number; variations: number; seed: number;
    verify: boolean; refine: boolean; checks: {id: string; question: string}[]; compiler_version: string};
  images: RunImage[]; request?: StudioRequest; files?: {references: Record<string, string>; mask: string | null};
  tasks?: Task[]; events?: RunEvent[];
}
export interface Health {studio_version: string; data_dir: string; comfy_url: string;
  comfy: {available: boolean; version?: string; devices?: string[]}; progress_live: boolean; lan_token: boolean;
  network_access?: {mode: 'local' | 'lan' | 'token'; allowed_networks: string[]; urls: string[]}}
