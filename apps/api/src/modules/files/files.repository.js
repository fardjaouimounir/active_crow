const fileFields = {
  id: true,
  kind: true,
  storageKey: true,
  thumbnailKey: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  width: true,
  height: true,
  visibility: true,
  uploadedById: true,
  createdAt: true,
};

/** BigInt sizes leave the repository as numbers (files are ≤ 20 MB). */
function serialize(row) {
  return row && { ...row, sizeBytes: Number(row.sizeBytes) };
}

export async function createFile(tx, scope, data) {
  return serialize(
    await tx.file.create({ data: { ...data, agencyId: scope.agencyId }, select: fileFields }),
  );
}

export async function findFile(db, scope, id) {
  return serialize(
    await db.file.findFirst({
      where: { id, agencyId: scope.agencyId, deletedAt: null },
      select: fileFields,
    }),
  );
}

export async function setVisibility(tx, scope, id, visibility) {
  return serialize(
    await tx.file.update({
      where: { id, agencyId: scope.agencyId },
      data: { visibility },
      select: fileFields,
    }),
  );
}
