import { announcementService as service } from './announcements.service.js';
export async function list(req, res) {
  const data = await service.list(req.actor, req.query);
  res.status(200).json(data);
}
export async function publish(req, res) {
  const data = await service.publish(req.actor, req.body);
  res.status(201).json({ data });
}
export async function preview(req, res) {
  const data = await service.preview(req.actor, req.query);
  res.status(200).json({ data });
}
export async function open(req, res) {
  const data = await service.open(req.actor, req.params.id);
  res.status(200).json({ data });
}
export async function reads(req, res) {
  const data = await service.reads(req.actor, req.params.id);
  res.status(200).json({ data });
}
