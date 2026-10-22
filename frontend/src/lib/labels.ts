import type {Category} from '../api/types';

export const CATEGORY_LABELS: Record<Category, string> = {
  subject: 'Pessoa', face: 'Rosto', body: 'Corpo', skin: 'Pele', hair: 'Cabelo', wardrobe: 'Roupa',
  environment: 'Cenário', pose: 'Pose', expression: 'Expressão', action: 'Ação', lighting: 'Iluminação',
  style: 'Estilo visual', camera: 'Câmera', framing: 'Enquadramento',
};
export const BASIC: Category[] = ['style', 'subject', 'environment', 'wardrobe', 'pose', 'action', 'expression', 'lighting'];
export const ADVANCED: Category[] = ['face', 'body', 'skin', 'hair', 'camera', 'framing'];

export const RUN_STATUS: Record<string, string> = {
  created: 'Na fila do Studio', preparing: 'Preparando referências', refining: 'Aprimorando o prompt',
  review: 'Aguardando sua revisão', generating: 'Gerando', detailing: 'Refinando os rostos',
  upscaling: 'Ampliando', verifying: 'Verificando o resultado',
  completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado', lost: 'Perdido', uncertain: 'Envio incerto',
};
export const TASK_STATUS: Record<string, string> = {
  created: 'aguardando', submitting: 'enviando', queued: 'na fila do ComfyUI', running: 'executando',
  completed: 'concluída', failed: 'falhou', cancelled: 'cancelada', lost: 'perdida', uncertain: 'confirmando envio',
};
export const PHASE: Record<string, string> = {
  loading_models: 'Carregando modelos', loading_images: 'Carregando imagens', encoding: 'Lendo o prompt e as referências',
  sampling: 'Gerando a imagem', decoding: 'Decodificando', compositing: 'Recompondo a área da máscara',
  saving: 'Salvando', detecting_faces: 'Detectando rostos', generating_text: 'Gerando texto', preparing: 'Preparando',
  upscaling: 'Ampliando a imagem', other: 'Outros',
};
export const KIND: Record<string, string> = {image: 'Imagem', refine: 'Aprimoramento', verify: 'Verificação',
  face_detect: 'Detecção de rostos', face: 'Rosto', upscale: 'Ampliação'};
export const VERDICT: Record<string, string> = {met: 'atendido', partial: 'parcial', unmet: 'não atendido', unknown: 'não avaliável'};
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'lost']);

export const POSTURE_LABELS: Record<string, string> = {
  any: 'qualquer', standing: 'em pé', seated: 'sentado', kneeling: 'ajoelhado', all_fours: 'de quatro',
  squatting: 'agachado', lying: 'deitado (qualquer lado)', supine: 'deitado de costas', prone: 'deitado de bruços',
  side_lying: 'deitado de lado', walking: 'caminhando', running: 'correndo',
};
export const PERIOD_LABELS: Record<string, string> = {
  any: 'qualquer', day: 'dia', golden: 'hora dourada', blue: 'hora azul', night: 'noite',
};
export const PLACE_LABELS: Record<string, string> = {any: 'qualquer', indoor: 'interno', outdoor: 'externo'};
export const ORIENTATION_LABELS: Record<string, string> = {
  any: 'qualquer', front: 'de frente', back: 'de costas', side: 'de perfil', three_quarter: 'três quartos',
};
export const GAZE_LABELS: Record<string, string> = {
  any: 'qualquer', camera: 'para a câmera', away: 'desviado da câmera', down: 'para baixo', up: 'para cima',
  back: 'por cima do ombro', closed: 'olhos fechados',
};
export const FRAMING_LABELS: Record<string, string> = {
  portrait: 'rosto e ombros', half: 'meio corpo', full: 'corpo inteiro', wide: 'plano aberto',
};
