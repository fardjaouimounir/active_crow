export function canApproveAssignment(actor, campaign, wilayaId) {
  if (actor.role === 'director') return true;
  if (actor.role === 'general_manager') return campaign.assignmentApproverRole !== 'director';
  return (
    actor.role === 'regional_manager' &&
    campaign.assignmentApproverRole === 'regional_manager' &&
    campaign.wilayas.some(
      ({ wilayaId: id, staff }) =>
        id === wilayaId &&
        staff.some((member) => member.userId === actor.id && member.role === 'regional_manager'),
    )
  );
}

export function assignmentWhere(actor) {
  const { id, agencyId, role } = actor;
  const wilaya = { staff: { some: { agencyId, userId: id, role: 'regional_manager' } } };
  const scoped = {
    regional_manager: { campaign: { wilayas: { some: wilaya } } },
    supervisor: { OR: [{ supervisorId: id }, { proposedById: id }] },
    animateur: { animateurId: id },
    client: { id: { in: [] } },
  };
  return { agencyId, ...scoped[role] };
}

export function canReadAssignment(actor, row, campaign) {
  if (row.agencyId !== actor.agencyId) return false;
  switch (actor.role) {
    case 'director':
    case 'general_manager':
      return true;
    case 'supervisor':
      return row.supervisorId === actor.id || row.proposedById === actor.id;
    case 'animateur':
      return row.animateurId === actor.id;
    case 'regional_manager':
      return campaign.wilayas.some(
        ({ wilayaId, staff }) =>
          wilayaId === row.pointOfSale.wilayaId &&
          staff.some(({ userId, role }) => userId === actor.id && role === 'regional_manager'),
      );
    default:
      return false;
  }
}
