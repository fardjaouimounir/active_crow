import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthCard } from '../src/features/system/components/HealthCard.jsx';
import { useHealthQuery } from '../src/features/system/api.js';
import { ApiError, NETWORK_ERROR } from '../src/shared/api/client.js';
import i18n from '../src/shared/i18n/index.js';

vi.mock('../src/features/system/api.js', () => ({ useHealthQuery: vi.fn() }));

const refetch = vi.fn();

/** @param {Partial<ReturnType<typeof useHealthQuery>>} state */
function mockQuery(state) {
  vi.mocked(useHealthQuery).mockReturnValue({
    data: undefined,
    error: null,
    isPending: false,
    isError: false,
    refetch,
    ...state,
  });
}

describe('HealthCard', () => {
  beforeEach(() => {
    refetch.mockReset();
  });

  it('shows the loading state', () => {
    mockQuery({ isPending: true });
    render(<HealthCard />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking the API…');
  });

  it('shows the healthy state with database, version and uptime', () => {
    mockQuery({ data: { status: 'ok', db: 'up', version: '0.1.0', uptimeSeconds: 42 } });
    render(<HealthCard />);

    expect(screen.getByRole('status')).toHaveTextContent('API healthy');
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('42 seconds')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the degraded state when the database is down (API answered 503)', async () => {
    await i18n.changeLanguage('ar');
    mockQuery({ data: { status: 'degraded', db: 'down', version: '0.1.0', uptimeSeconds: 5 } });
    render(<HealthCard />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'الخادم يعمل لكن قاعدة البيانات غير متاحة',
    );
    expect(screen.getByText('غير متاحة')).toBeInTheDocument();
  });

  it('shows the translated error state and retries on demand', async () => {
    mockQuery({
      isError: true,
      error: new ApiError({ code: NETWORK_ERROR, message: 'Network Error' }),
    });
    render(<HealthCard />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('API unavailable');
    expect(alert).toHaveTextContent('Cannot reach the server. Check your connection.');

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('translates the error state in Arabic and shows the request reference', async () => {
    await i18n.changeLanguage('ar');
    mockQuery({
      isError: true,
      error: new ApiError({
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: '3f2b8c1e-7d4a-4b9e-8c2f-1a2b3c4d5e6f',
        status: 500,
      }),
    });
    render(<HealthCard />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('الخادم غير متاح');
    expect(alert).toHaveTextContent('3f2b8c1e-7d4a-4b9e-8c2f-1a2b3c4d5e6f');
  });
});
