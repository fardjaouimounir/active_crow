import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import {
  DensityToggle,
  Pagination,
  SortHeader,
  TableFrame,
  tableClass,
  useDensity,
} from '../../ui/data.jsx';
import { Skeleton } from '../../ui/primitives.jsx';
import { EmptyState, Toast } from './PageParts.jsx';

/**
 * Renders server-sorted rows and requests the next page through callbacks.
 * Column `meta`: `sortable` (server sort), `numeric` (right-aligned, tabular figures).
 */
export function DataTable({
  columns,
  rows,
  page = 1,
  pageSize = 25,
  total = 0,
  sort,
  onSort,
  onPage,
  onRowClick,
  loading,
  error,
}) {
  const { t, i18n } = useTranslation('common');
  const [density] = useDensity();
  const compact = density === 'compact';
  const [id, direction] = (sort ?? '').split(':');
  // TanStack Table v8 returns mutable getters and renders directly in this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
    getRowId: (row) => row.id,
    state: {
      pagination: { pageIndex: page - 1, pageSize },
      sorting: id ? [{ id, desc: direction === 'desc' }] : [],
    },
  });
  if (error) return <Toast message={error} error />;
  if (loading)
    return (
      <div role="status" className="grid gap-px overflow-hidden rounded-lg border border-line">
        <span className="sr-only">{t('admin.loading')}</span>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-9 rounded-none" />
        ))}
      </div>
    );
  if (rows.length === 0 && page === 1) return <EmptyState />;
  const format = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <TableFrame>
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className={tableClass.head}>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const numeric = header.column.columnDef.meta?.numeric;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={tableClass.th(compact, numeric)}
                      aria-sort={
                        header.id === id
                          ? direction === 'desc'
                            ? 'descending'
                            : 'ascending'
                          : undefined
                      }
                    >
                      {header.column.columnDef.meta?.sortable && onSort ? (
                        <SortHeader
                          direction={header.id === id ? direction : undefined}
                          onClick={() =>
                            onSort(
                              header.id +
                                ':' +
                                (header.id === id && direction === 'asc' ? 'desc' : 'asc'),
                            )
                          }
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </SortHeader>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={tableClass.row(Boolean(onRowClick))}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={tableClass.td(compact, cell.column.columnDef.meta?.numeric)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && (
        <div className="flex items-center justify-between gap-3 border-t border-line">
          <div className="min-w-0 flex-1">
            <Pagination
              page={page}
              pages={table.getPageCount()}
              onPage={onPage}
              format={(value) => format.format(value)}
              bare
            />
          </div>
          <div className="pe-3">
            <DensityToggle />
          </div>
        </div>
      )}
    </TableFrame>
  );
}
