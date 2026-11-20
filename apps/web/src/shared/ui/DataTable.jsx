import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { EmptyState, Toast } from './PageParts.jsx';

/** Renders server-sorted rows and requests the next page through callbacks. */
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
      <div role="status" className="grid gap-2">
        <span className="sr-only">{t('admin.loading')}</span>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-10 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    );
  if (rows.length === 0 && page === 1) return <EmptyState />;
  const format = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-start text-sm">
          <thead className="bg-slate-50">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className="px-4 py-3 text-start font-medium"
                    aria-sort={
                      header.id === id
                        ? direction === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : undefined
                    }
                  >
                    {header.column.columnDef.meta?.sortable && onSort ? (
                      <button
                        type="button"
                        onClick={() =>
                          onSort(
                            header.id +
                              ':' +
                              (header.id === id && direction === 'asc' ? 'desc' : 'asc'),
                          )
                        }
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}{' '}
                        {header.id === id ? (direction === 'asc' ? '↑' : '↓') : '↕'}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={
                  'border-t border-slate-100 ' +
                  (onRowClick ? 'cursor-pointer hover:bg-slate-50' : '')
                }
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
          <span>
            {t('admin.page', {
              page: format.format(page),
              pages: format.format(Math.max(1, table.getPageCount())),
            })}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => onPage(page - 1)}
              disabled={!table.getCanPreviousPage()}
              className="disabled:opacity-40"
            >
              {t('admin.previous')}
            </button>
            <button
              type="button"
              onClick={() => onPage(page + 1)}
              disabled={!table.getCanNextPage()}
              className="disabled:opacity-40"
            >
              {t('admin.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
