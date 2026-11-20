import { referenceService } from './reference.service.js';

function send(res, data) {
  res.set('Cache-Control', 'private, max-age=86400').json({ data });
}

export async function wilayas(_req, res) {
  send(res, await referenceService.listWilayas());
}

export async function communes(req, res) {
  send(res, await referenceService.listCommunes(req.params.id));
}
