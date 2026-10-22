// Fichas de personagem: limits shared by the screen and the request form, and the check on the notes.
export const CHARACTER_NAME_MAX = 60;
export const CHARACTER_NOTES_MAX = 500;
export const CHARACTER_PHOTOS_MAX = 6;

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
