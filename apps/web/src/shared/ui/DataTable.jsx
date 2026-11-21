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
 * Column `meta`: `sortable` (server sort), `numeric` (right-aligned, tabular figures), `width`
 * (CSS width of the column). `hidden` = Set of column ids to hide (see useColumnVisibility);
 * `rowActions(row)` renders actions revealed on row hover/focus (always visible on touch);
 * `selectable` + `selected`/`onSelect` add checkboxes and a bulk bar rendered by `bulkBar({ count, clear })`.
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
  hidden,
  rowActions,
  selectable = false,
  selected,
  onSelect,
  bulkBar,
  empty,
}) {
  const { t, i18n } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
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
      columnVisibility: Object.fromEntries([...(hidden ?? [])].map((column) => [column, false])),
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
  if (rows.length === 0 && page === 1) return empty ?? <EmptyState />;
  const format = new Intl.NumberFormat(i18n.resolvedLanguage);
  const pageRows = table.getRowModel().rows;
  const chosen = selected ?? new Set();
  const allChosen = pageRows.length > 0 && pageRows.every((row) => chosen.has(row.id));
  const toggleAll = () =>
    onSelect?.(allChosen ? new Set() : new Set(pageRows.map((row) => row.id)));
  const toggleOne = (rowId) => {
    const next = new Set(chosen);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    onSelect?.(next);
  };
  return (
    <div className="space-y-2">
      {selectable && chosen.size > 0 && bulkBar && (
        <div
          role="region"
          aria-label={tp('list.selection')}
          className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-sm"
        >
          {bulkBar({ count: chosen.size, clear: () => onSelect?.(new Set()) })}
        </div>
      )}
      <TableFrame>
        <div className="overflow-x-auto">
          <table className={tableClass.table}>
            <thead className={tableClass.head}>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {selectable && (
                    <th scope="col" className={tableClass.th(compact) + ' w-9'}>
                      <input
                        type="checkbox"
                        checked={allChosen}
                        onChange={toggleAll}
                        aria-label={tp('list.selectAll')}
                      />
                    </th>
                  )}
                  {group.headers.map((header) => {
                    const numeric = header.column.columnDef.meta?.numeric;
                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className={tableClass.th(compact, numeric)}
                        style={{ width: header.column.columnDef.meta?.width }}
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
                  {rowActions && (
                    <th scope="col" className={tableClass.th(compact) + ' w-px'}>
                      <span className="sr-only">{tp('list.actions')}</span>
                    </th>
                  )}
                </tr>
              ))}
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr
                  key={row.id}
                  className={'group ' + tableClass.row(Boolean(onRowClick), chosen.has(row.id))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {selectable && (
                    <td
                      className={tableClass.td(compact)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={tp('list.selectRow')}
                      />
                    </td>
                  )}
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={tableClass.td(compact, cell.column.columnDef.meta?.numeric)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  {rowActions && (
                    <td
                      className={tableClass.td(compact) + ' w-px whitespace-nowrap'}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex justify-end gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                        {rowActions(row.original)}
                      </div>
                    </td>
                  )}
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
    </div>
  );
}
