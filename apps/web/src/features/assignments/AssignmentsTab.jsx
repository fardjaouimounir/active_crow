import { ASSIGNMENT_STATUSES, today } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { DataTable } from '../../shared/ui/DataTable.jsx';
import { FilterBar, useFilters } from '../../shared/ui/FilterBar.jsx';
import { EmptyState, StatusBadge, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import {
  InputField,
  SelectField,
  actionStyle,
  primaryStyle,
} from '../organization/components/Fields.jsx';
import { useAssignments, useStaffing } from './api.js';
import { DecisionDialog } from './DecisionDialog.jsx';
import { ProposeDialog } from './ProposeDialog.jsx';

const accepting = ['planning', 'assigned', 'active'];
const fields = [
  'status',
  'wilayaId',
  'pointOfSaleId',
  'supervisorId',
  'animateurId',
  'from',
  'to',
  'page',
  'pageSize',
];
const areaName = (area, language) => (language === 'ar' ? area.wilaya.nameAr : area.wilaya.nameEn);

function Staffing({ campaign }) {
  const { t, i18n } = useTranslation('common');
  const { filters, setFilter } = useFilters();
  const selectedDate = filters.staffingDate ?? today();
  const query = useStaffing(campaign.id, selectedDate);
  const { message } = useApiError(query.error);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <section className="space-y-3" aria-label={t('assignments.staffing')}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold">{t('assignments.staffing')}</h2>
        <InputField
          name="effectiveDate"
          label="viewDate"
          type="date"
          value={selectedDate}
          onChange={(value) => setFilter('staffingDate', value)}
        />
      </div>
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      {message && <Toast error message={message} />}
      {query.isSuccess && !query.data.data.length && <EmptyState />}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(query.data?.data ?? []).map((item) => (
          <li
            key={item.wilayaId}
            className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm"
          >
            <h3 className="font-semibold">{areaName(item, i18n.resolvedLanguage)}</h3>
            <p>
              {t('assignments.coverage', {
                approved: number.format(item.approvedAnimateurs),
                required: number.format(item.requiredAnimateurs),
              })}
            </p>
            <p>{t('assignments.proposedCount', { count: number.format(item.proposedCount) })}</p>
            <p>
              {t('assignments.uncovered')}{' '}
              {item.uncoveredPointsOfSale.map(({ name }) => name).join(' · ') || '—'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function mayApprove(user, campaign, wilayaId) {
  if (user.role === 'director') return true;
  if (user.role === 'general_manager') return campaign.assignmentApproverRole !== 'director';
  return (
    user.role === 'regional_manager' &&
    campaign.assignmentApproverRole === 'regional_manager' &&
    campaign.wilayas.some(
      (area) =>
        area.wilayaId === wilayaId &&
        area.staff.some(
          ({ role, user: person }) => role === 'regional_manager' && person.id === user.id,
        ),
    )
  );
}

export function AssignmentsTab({ campaign }) {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  const propose = useCan('assignment.propose');
  const approve = useCan('assignment.approve');
  const { filters, setFilter } = useFilters();
  const query = useAssignments(
    campaign.id,
    Object.fromEntries(fields.filter((key) => filters[key]).map((key) => [key, filters[key]])),
  );
  const { message } = useApiError(query.error);
  const [selected, select] = useState([]);
  const [dialog, setDialog] = useState(null);
  const open = accepting.includes(campaign.status);
  const canEnd = open || campaign.status === 'suspended';
  const rows = query.data?.data ?? [];
  const eligible = (row) =>
    open &&
    approve &&
    row.status === 'proposed' &&
    mayApprove(user, campaign, row.pointOfSale.wilayaId);
  const selection = rows.filter((row) => selected.includes(row.id) && eligible(row));
  const toggle = (id) =>
    select((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const formatDate = (day) => dateFormat.format(new Date(day));
  function actions(row) {
    const approver = approve && mayApprove(user, campaign, row.pointOfSale.wilayaId);
    if (row.status === 'proposed') {
      return [
        ...(eligible(row) ? ['approve', 'reject'] : []),
        ...(canEnd && (approver || row.proposedById === user.id) ? ['cancel'] : []),
      ];
    }
    if (row.status !== 'approved') return [];
    return [
      ...(approver && canEnd && row.startDate > today() ? ['cancel'] : []),
      ...(approver && canEnd && row.endDate > today() && row.startDate < row.endDate
        ? ['end']
        : []),
      ...(open &&
      row.endDate > today() &&
      (approver || (propose && user.role === 'supervisor' && row.supervisorId === user.id))
        ? ['replace']
        : []),
    ];
  }
  const columns = [
    ...(approve && open
      ? [
          {
            id: 'select',
            header: t('assignments.selection'),
            cell: ({ row }) =>
              eligible(row.original) && (
                <input
                  type="checkbox"
                  aria-label={row.original.animateur.fullName}
                  checked={selected.includes(row.original.id)}
                  onChange={() => toggle(row.original.id)}
                />
              ),
          },
        ]
      : []),
    {
      id: 'animateur',
      header: t('roles.animateur'),
      cell: ({ row }) => (
        <span id={'assignment-' + row.original.id}>
          {row.original.animateur.fullName}
          {row.original.replacesAssignmentId && (
            <a
              className="block text-xs underline"
              href={'#assignment-' + row.original.replacesAssignmentId}
            >
              {t('assignments.replacement')}
            </a>
          )}
        </span>
      ),
    },
    { id: 'point', header: t('admin.point'), cell: ({ row }) => row.original.pointOfSale.name },
    {
      id: 'supervisor',
      header: t('admin.supervisor'),
      cell: ({ row }) => row.original.supervisor.fullName,
    },
    {
      id: 'dates',
      header: t('campaigns.period'),
      cell: ({ row }) => (
        <bdi>
          {formatDate(row.original.startDate)} – {formatDate(row.original.endDate)}
        </bdi>
      ),
    },
    {
      accessorKey: 'status',
      header: t('admin.status'),
      cell: ({ getValue }) => (
        <StatusBadge
          tone={getValue() === 'approved' ? 'good' : getValue() === 'proposed' ? 'warn' : 'neutral'}
        >
          {t('assignments.status.' + getValue())}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: t('assignments.actions'),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {actions(row.original).map((action) => (
            <button
              key={action}
              className={actionStyle}
              type="button"
              onClick={() => setDialog({ action, rows: [row.original] })}
            >
              {t('assignments.' + action)}
            </button>
          ))}
        </div>
      ),
    },
  ];
  const people = (key) =>
    Array.from(
      new Map(
        rows.map((row) => [row[key].id, { value: row[key].id, label: row[key].fullName }]),
      ).values(),
    );
  return (
    <div className="space-y-5">
      <Staffing campaign={campaign} />
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t('campaigns.tabs.assignments')}</h2>
          <div className="flex flex-wrap gap-2">
            {propose && open && (
              <button
                className={primaryStyle}
                type="button"
                onClick={() => setDialog({ action: 'propose' })}
              >
                {t('assignments.propose')}
              </button>
            )}
            {selection.length > 0 &&
              ['approve', 'reject'].map((action) => (
                <button
                  key={action}
                  type="button"
                  className={actionStyle}
                  onClick={() => setDialog({ action, rows: selection, batch: true })}
                >
                  {t('assignments.' + action)}
                </button>
              ))}
          </div>
        </div>
        <FilterBar>
          <SelectField
            name="status"
            blank="all"
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={ASSIGNMENT_STATUSES.map((value) => ({
              value,
              label: t('assignments.status.' + value),
            }))}
          />
          <SelectField
            name="wilaya"
            blank="all"
            value={filters.wilayaId}
            onChange={(value) => setFilter('wilayaId', value)}
            options={campaign.wilayas.map((area) => ({
              value: area.wilayaId,
              label: areaName(area, i18n.resolvedLanguage),
            }))}
          />
          <SelectField
            name="point"
            blank="all"
            value={filters.pointOfSaleId}
            onChange={(value) => setFilter('pointOfSaleId', value)}
            options={campaign.pointsOfSale.map(({ id, name }) => ({ value: id, label: name }))}
          />
          {[
            ['supervisor', 'supervisorId'],
            ['animateur', 'animateurId'],
          ].map(([name, key]) => (
            <SelectField
              key={name}
              name={name}
              blank="all"
              value={filters[key]}
              onChange={(value) => setFilter(key, value)}
              options={people(name)}
            />
          ))}
          {['from', 'to'].map((name) => (
            <InputField
              key={name}
              name={name}
              type="date"
              value={filters[name]}
              onChange={(value) => setFilter(name, value)}
            />
          ))}
        </FilterBar>
        <DataTable
          columns={columns}
          rows={rows}
          {...query.data?.meta}
          onPage={(value) => setFilter('page', value)}
          loading={query.isPending || query.isPlaceholderData}
          error={message}
        />
      </section>
      {dialog?.action === 'propose' ? (
        <ProposeDialog campaign={campaign} onClose={() => setDialog(null)} />
      ) : (
        dialog && (
          <DecisionDialog
            {...dialog}
            onClose={() => {
              setDialog(null);
              select([]);
            }}
          />
        )
      )}
    </div>
  );
}
