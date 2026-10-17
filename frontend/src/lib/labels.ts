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
  review: 'Aguardando sua revisão', generating: 'Gerando', verifying: 'Verificando o resultado',
  completed: 'Concluído', failed: 'Falhou', cancelled: 'Cancelado', lost: 'Perdido', uncertain: 'Envio incerto',
};
export const TASK_STATUS: Record<string, string> = {
  created: 'aguardando', submitting: 'enviando', queued: 'na fila do ComfyUI', running: 'executando',
  completed: 'concluída', failed: 'falhou', cancelled: 'cancelada', lost: 'perdida', uncertain: 'confirmando envio',
};
export const PHASE: Record<string, string> = {
  loading_models: 'Carregando modelos', loading_images: 'Carregando imagens', encoding: 'Lendo o prompt e as referências',
  sampling: 'Gerando a imagem', decoding: 'Decodificando', compositing: 'Recompondo a área da máscara',
  saving: 'Salvando', generating_text: 'Gerando texto', preparing: 'Preparando', other: 'Outros',
};
export const KIND: Record<string, string> = {image: 'Imagem', refine: 'Aprimoramento', verify: 'Verificação'};
export const VERDICT: Record<string, string> = {met: 'atendido', partial: 'parcial', unmet: 'não atendido', unknown: 'não avaliável'};
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'lost']);
