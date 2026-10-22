// Mirrors backend/src/prisma_studio/domain/request.py (contract v1). Keep both in sync; /api/contract exposes the schema.
export const CATEGORIES = ['subject', 'face', 'body', 'skin', 'hair', 'wardrobe', 'environment', 'pose',
  'expression', 'action', 'lighting', 'style', 'camera', 'framing'] as const;
export type Category = typeof CATEGORIES[number];
export type Intent = 'keep' | 'set' | 'transfer' | 'free';
export type Support = 'floor' | 'seat' | 'bed' | 'wall' | 'table';
export type Framing = 'portrait' | 'half' | 'full' | 'wide';
export type Period = 'day' | 'golden' | 'blue' | 'night' | 'any';
export type Place = 'indoor' | 'outdoor' | 'any';
export type Posture = 'standing' | 'seated' | 'kneeling' | 'all_fours' | 'squatting' | 'lying' | 'supine' | 'prone'
  | 'side_lying' | 'walking' | 'running' | 'any';
export type Orientation = 'front' | 'back' | 'side' | 'three_quarter' | 'any';
export type Gaze = 'camera' | 'away' | 'down' | 'up' | 'back' | 'closed' | 'any';

export type Value = {kind: 'catalog'; item_id: string} | {kind: 'text'; text: string};
export interface Attribute {intent: Intent; value?: Value; reference_id?: string}
export interface Reference {id: string; label: string}
export type CharacterPosition = 'left' | 'right' | 'behind' | 'front';
export interface Character {reference_id: string; description: string; position?: CharacterPosition | null}

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
  face_detail?: boolean | null;   // null = automatic: on with two or more people
}

export interface LoraChoice {name: string; strength: number}
export interface Engine {
  steps?: number | null; cfg?: number | null; sampler?: string | null; scheduler?: string | null;
  denoise?: number | null; negative_prompt: string;
  loras?: LoraChoice[];
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
  support_any_of?: Support[] | null; minimum_framing?: Framing | null; children?: boolean | null;
}
export interface Item {
  id: string; category: Category; label: string; prompt: string; edit_prompt?: string | null;
  adult: boolean; enabled: boolean; requirements: Requirements;
  provides: {supports?: Support[] | null; framing?: Framing | null; view?: Orientation | null; period?: Period | null;
    place?: Place | null};
}
export interface LibrarySnapshot {revision: number; items: Item[]; origins: Record<string, 'builtin' | 'user' | 'custom'>}

export interface Issue {code: string; level: 'error' | 'warning' | 'adjusted' | 'unknown'; kind: 'product' | 'model' | 'policy'; field: string; message: string}
export interface Prepared {
  valid: boolean; status: string; issues: Issue[]; slots: Record<string, number>; prompt: string | null;
  segments: {block: string; text: string}[]; checks: {id: string; question: string}[];
  participants?: {total: number | null; automatic: number | null; reason: string | null};
  suggestions?: Suggestion[];
}
// The value that fits the chosen pose or action, or ends a clash between two chosen options (source 'scene': light ×
// setting, lens × framing). `auto` ones, never 'scene', are applied while the person has not touched the field.
export interface Suggestion {field: Category; attribute: Attribute | null; context: Partial<StudioRequest['context']>;
  label: string; reason: string; source: 'pose' | 'action' | 'scene'; auto: boolean}
export interface PeopleCount {id: string; status: string; count?: number; error?: string}

// A "Pedido salvo": the choices of a request without its photos, seed, people count, supports or consents.
export interface SavedRequest {id: string; name: string; request: StudioRequest; created_at: number; updated_at: number}

export interface Verdict {verdict: 'met' | 'partial' | 'unmet' | 'unknown'; note: string}
export interface RunImage {task_id: string; position: number; seed: number; status: string; files: string[];
  score?: number | null; verdicts?: Record<string, Verdict> | null;
  detail?: {found: number; refined: number; expected?: number | null; people?: number | null} | null; raw_files?: string[]}   // raw_files: before the face detail pass
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
    verify: boolean; refine: boolean; face_detail?: boolean; checks: {id: string; question: string}[];
    compiler_version: string};
  images: RunImage[]; request?: StudioRequest; files?: {references: Record<string, string>; mask: string | null};
  tasks?: Task[]; events?: RunEvent[];
}
export interface Health {studio_version: string; data_dir: string; comfy_url: string;
  comfy: {available: boolean; version?: string; devices?: string[]}; progress_live: boolean; lan_token: boolean;
  network_access?: {mode: 'local' | 'lan' | 'token'; allowed_networks: string[]; urls: string[]}}

export interface GpuReading {name: string; utilization: number | null; temperature: number | null; power_draw: number | null;
  power_limit: number | null; memory_used: number | null; memory_total: number | null}
export interface Stats {
  at: number;
  comfy: {available: boolean; ram_total?: number | null; ram_free?: number | null;
    devices?: {name: string; vram_total: number | null; vram_free: number | null}[]};
  gpus: GpuReading[] | null;                            // null: nvidia-smi is not available
  disk: {path: string; total: number; free: number; studio_bytes: number | null};
  usage: {runs: number; failed: number; images: number; gpu_seconds: number; power_watts: number | null; energy_kwh: number | null};
}

export interface CoherenceIssue {severity: 'error' | 'warning'; quote: string; problem: string; suggestion: string}
export interface CoherenceJob {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; prompt?: string; error?: string | null;
  omitted?: number;                                     // adult instructions left out of the review
  result?: {coherent: boolean | null; issues: CoherenceIssue[]; raw?: string; dropped?: number; truncated?: boolean};
}

export interface TextFinding {code: string; level: 'conflict' | 'ambiguity' | 'style'; message: string}
// A quick Turbo preview of a pose or action draft; the image is kept only in the server's memory.
export interface PoseTest {id: string; status: string; prompt?: string; has_image?: boolean; error?: string | null; warning?: string}

// A "Personagem" saved for reuse ("fichas de personagem"). Photos are file hashes; photos[0] is the main one.
// Named SavedCharacter here because `Character` above is the character of one request.
export interface SavedCharacter {id: string; name: string; notes: string; photos: string[]; created_at: number; updated_at: number}
export interface SavedCharacterInput {name: string; notes: string; photos: string[]}
