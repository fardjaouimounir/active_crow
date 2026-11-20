import { aiService } from './ai.service.js';

export async function request(req, res) {
  const { request: data, created } = await aiService.requestSuggestion(req.actor, req.body);
  res.status(created ? 201 : 200).json({ data, meta: { created } });
}

export async function listRequests(req, res) {
  res.json(await aiService.listRequests(req.actor, req.query));
}

export async function listSuggestions(req, res) {
  res.json(await aiService.listSuggestions(req.actor, req.query));
}

export async function getSuggestion(req, res) {
  res.json({ data: await aiService.getSuggestion(req.actor, req.params.id) });
}

export async function accept(req, res) {
  res.json({ data: await aiService.accept(req.actor, req.params.id, req.body, req) });
}

export async function reject(req, res) {
  res.json({ data: await aiService.reject(req.actor, req.params.id, req.body, req) });
}

export async function commentary(req, res) {
  res.json({ data: await aiService.commentary(req.actor, req.query) });
}

/** Callback of the AI service: always 200 for a stored or duplicate result. */
export async function receiveResult(req, res) {
  res.status(200).json({ data: await aiService.receiveResult(req.body) });
}
