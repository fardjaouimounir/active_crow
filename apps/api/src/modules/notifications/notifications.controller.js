import { notificationService as service } from './notifications.service.js';
export async function list(req, res) {
  const data = await service.list(req.actor, req.query);
  res.status(200).json(data);
}
export async function count(req, res) {
  const data = await { count: await service.unreadCount(req.actor) };
  res.status(200).json({ data });
}
export async function readAll(req, res) {
  const data = await service.read(req.actor);
  res.status(200).json({ data });
}
export async function read(req, res) {
  const data = await service.read(req.actor, req.params.id);
  res.status(200).json({ data });
}
