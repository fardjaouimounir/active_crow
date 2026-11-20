export function issueScope(actor) {
  const { agencyId, id, role } = actor;
  if (role === 'director' || role === 'general_manager') return { agencyId };
  if (role === 'animateur') return { agencyId, reportedById: id };
  if (role === 'client') return { agencyId, id: { in: [] } };
  return {
    agencyId,
    OR: [
      ...(role === 'supervisor' ? [{ reportedById: id }] : []),
      { campaign: { wilayas: { some: { staff: { some: { agencyId, userId: id, role } } } } } },
    ],
  };
}

export function canReadIssue(actor, issue) {
  if (actor.agencyId !== issue.agencyId) return false;
  if (['director', 'general_manager'].includes(actor.role)) return true;
  if (actor.role === 'client') return false;
  if (['animateur', 'supervisor'].includes(actor.role) && issue.reportedById === actor.id)
    return true;
  if (!['regional_manager', 'supervisor'].includes(actor.role)) return false;
  return issue.campaign.wilayas.some(
    ({ wilayaId, staff }) =>
      (issue.pointOfSale
        ? issue.pointOfSale.wilayaId === wilayaId
        : actor.role === 'regional_manager') &&
      staff.some((member) => member.userId === actor.id && member.role === actor.role),
  );
}
