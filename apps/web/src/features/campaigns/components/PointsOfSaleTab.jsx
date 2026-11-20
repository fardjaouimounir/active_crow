import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { TextInput } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useWilayas } from '../../organization/api.js';
import {
  actionStyle,
  areaOptions,
  primaryStyle,
  SelectField,
} from '../../organization/components/Fields.jsx';
import { useCampaignWrite, usePointOptions } from '../api.js';

const PAGE_SIZE = 25;

function AddPointsDialog({ campaign, wilayaNames, onClose }) {
  const { t } = useTranslation('common');
  const [wilayaId, setWilayaId] = useState(String(campaign.wilayas[0]?.wilayaId ?? ''));
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const linked = new Set(campaign.pointsOfSale.map(({ id }) => id));
  const results = usePointOptions(search, wilayaId ? Number(wilayaId) : undefined);
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error ?? results.error);
  const toggle = (id) =>
    setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return (
    <Modal title={t('campaigns.addPoints')} onClose={onClose}>
      <div className="grid gap-4">
        <SelectField
          name="wilaya"
          value={wilayaId}
          options={wilayaNames.filter((item) =>
            campaign.wilayas.some((row) => row.wilayaId === item.value),
          )}
          onChange={setWilayaId}
        />
        <TextInput
          type="search"
          aria-label={t('admin.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {results.pending && <p role="status">{t('admin.loading')}</p>}
        <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm">
          {results.rows
            .filter((point) => !linked.has(point.id))
            .map((point) => (
              <li key={point.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(point.id)}
                    onChange={() => toggle(point.id)}
                  />
                  {point.name} <bdi className="text-slate-500">{point.code}</bdi>
                </label>
              </li>
            ))}
        </ul>
        <Toast error message={message} />
        <div>
          <button
            type="button"
            className={primaryStyle}
            disabled={!selected.length || mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  method: 'put',
                  path: '/campaigns/' + campaign.id + '/points-of-sale',
                  body: { pointOfSaleIds: [...linked, ...selected] },
                },
                { onSuccess: onClose },
              )
            }
          >
            {t('campaigns.addSelected', { count: selected.length })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** FR-031: points of sale of the campaign (only in its wilayas). */
export function PointsOfSaleTab({ campaign, canEdit }) {
  const { t, i18n } = useTranslation('common');
  const wilayas = useWilayas();
  const names = areaOptions(wilayas.data?.data, i18n.resolvedLanguage);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const rows = campaign.pointsOfSale;
  const columns = [
    { accessorKey: 'name', header: t('admin.name') },
    {
      accessorKey: 'code',
      header: t('admin.code'),
      cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
    },
    {
      accessorKey: 'wilayaId',
      header: t('admin.wilaya'),
      cell: ({ getValue }) => names.find((item) => item.value === getValue())?.label ?? getValue(),
    },
    ...(canEdit
      ? [
          {
            id: 'actions',
            header: t('catalog.actions'),
            cell: ({ row }) => (
              <button
                type="button"
                className={actionStyle}
                aria-label={t('campaigns.remove') + ' ' + row.original.name}
                onClick={() => setDialog({ type: 'remove', point: row.original })}
              >
                {t('campaigns.remove')}
              </button>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="grid gap-4">
      {canEdit && (
        <div>
          <button
            type="button"
            className={primaryStyle}
            disabled={!campaign.wilayas.length}
            onClick={() => setDialog({ type: 'add' })}
          >
            {t('campaigns.addPoints')}
          </button>
        </div>
      )}
      {rows.length ? (
        <DataTable
          columns={columns}
          rows={rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          page={page}
          pageSize={PAGE_SIZE}
          total={rows.length}
          onPage={setPage}
        />
      ) : (
        <EmptyState />
      )}
      {dialog?.type === 'add' && (
        <AddPointsDialog campaign={campaign} wilayaNames={names} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'remove' && (
        <ConfirmDialog
          title={t('campaigns.remove')}
          message={t('catalog.confirmDelete', { name: dialog.point.name })}
          pending={mutation.isPending}
          onClose={() => {
            setDialog(null);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate(
              {
                method: 'put',
                path: '/campaigns/' + campaign.id + '/points-of-sale',
                body: {
                  pointOfSaleIds: rows.map(({ id }) => id).filter((id) => id !== dialog.point.id),
                },
              },
              { onSuccess: () => setDialog(null) },
            )
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
    </div>
  );
}
