import type {StudioRequest} from '../api/types';

// Fichas de personagem: limits shared by the screen and the request form, and the check on the notes.
export const CHARACTER_NAME_MAX = 60;
export const CHARACTER_NOTES_MAX = 500;
export const CHARACTER_PHOTOS_MAX = 6;

// Folha de referência: one generation per view, each sent as a manual prompt with the main photo as <image1>.
const SAME = 'the same face, hairstyle, skin tone, body and clothing as the person in <image1>; use <image1> only for who the person is and what they wear, never for the pose, the place or the light.';
const FULL_BODY = (pose: string) => `Create an image. A full-body photograph of one person standing relaxed with the arms at the sides, ${pose}, on a plain light gray studio background, with ${SAME} Even soft studio light, sharp focus, photorealistic.`;
export const SHEET_VIEWS = [
  {label: 'Frente', text: FULL_BODY('facing the camera, front view')},
  {label: 'Três quartos', text: FULL_BODY('turned three-quarters to the side, head toward the camera')},
  {label: 'Perfil', text: FULL_BODY('in side profile, facing left')},
  {label: 'Retrato', text: `Create an image. A head-and-shoulders portrait photograph of one person facing the camera, on a plain light gray studio background, with ${SAME} Even soft studio light, sharp focus on the face, photorealistic.`},
];

/** The request of one view of the folha: a Turbo manual prompt, 3:4, one variation, the main photo as reference "p". */
export function sheetRequest(text: string, name: string): StudioRequest {
  return {
    schema_version: 1, mode: 'generate', content_mode: 'standard', prompt_mode: 'manual', manual_prompt: text,
    attributes: {}, wardrobe_scope: 'primary', references: [{id: 'p', label: name}], target_id: null, mask: false,
    characters: [], participants: {requested: null, existing: null},
    context: {supports: null, allow_new_supports: false, allow_reframing: true, original_framing: null},
    details: '', confirmations: [],
    output: {profile: 'turbo', resolution: 1024, aspect: '3:4', width: null, height: null, seed: null, variations: 1,
      verify: false, refine: false, face_detail: null},
    engine: {negative_prompt: ''},
  };
}

// Words that describe the face or the hair. With a photo they make the model ignore the photo, so the notes warn about them.
const FACE_WORDS = /\b(olhos?|eyes?|cabelos?|hair|loir[oa]s?|blond(?:e|es)?|ruiv[oa]s?|barbas?|beards?|bigodes?|sardas?|freckles?)\b/gi;

/** The distinct face or hair words found in the notes, in lowercase, in the order they appear. */
export function faceWordsIn(notes: string): string[] {
  const found = (notes.match(FACE_WORDS) ?? []).map(word => word.toLowerCase());
  return [...new Set(found)];
}

/** Size of an image stored on the server, read from the image itself. */
export function imageSize(url: string): Promise<{width: number; height: number}> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({width: image.naturalWidth, height: image.naturalHeight});
    image.onerror = () => reject(new Error('Não foi possível abrir a foto da ficha.'));
    image.src = url;
  });
}
