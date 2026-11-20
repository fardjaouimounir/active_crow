import { NotFoundError } from '../../core/errors/index.js';
import { findWilayaCommunes, listWilayas } from './reference.repository.js';

async function listCommunes(wilayaId) {
  const communes = await findWilayaCommunes(wilayaId);
  if (!communes) throw new NotFoundError();
  return communes;
}

export const referenceService = Object.freeze({ listWilayas, listCommunes });
