import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

const employee = {
  id: '33221111-1111-4111-8111-111111111111',
  role: 'animateur',
  fullName: 'Amine Bensalem',
  email: 'amine@example.dz',
  status: 'active',
  createdAt: '2026-11-19T00:00:00Z',
};
const supervisor = {
  ...employee,
  id: '44221111-1111-4111-8111-111111111111',
  role: 'supervisor',
  fullName: 'Nadia Kaci',
};
const result = (data) => [200, { data }];
const detail = (user = employee) =>
  result({ user, profile: null, currentManager: supervisor, reportingLines: [] });
let api;

// jsdom does not implement the native dialog methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

function stub(role, handlers = {}) {
  const user = makeUser({ role });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => result({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /reference/wilayas': () => result([]),
    'GET /users': ({ params }) => [
      200,
      {
        data: params.role === 'supervisor' ? [supervisor] : [employee],
        meta: { total: 51, page: Number(params.page ?? 1), pageSize: 25 },
      },
    ],
    ['GET /users/' + employee.id]: () => detail(),
    ...handlers,
  });
  return api;
}

afterEach(async () => {
  cleanup();
  api?.restore();
  resetSessionForTests();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('organization administration', () => {
  it('keeps server page, search and sort in the URL and preserves it after opening a row', async () => {
    stub('director');
    const user = userEvent.setup();
    const view = renderApp('/app/users?page=2');
    await screen.findByRole('table');
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() => expect(view.location()).toBe('/app/users?page=3'));
    await screen.findByText('Page 3 of 3');
    await user.click(await screen.findByRole('button', { name: /Full name/ }));
    await waitFor(() => expect(view.location()).toContain('sort=fullName%3Adesc'));
    await user.type(screen.getAllByRole('searchbox')[0], 'Amine');
    await waitFor(() => expect(view.location()).toContain('q=Amine'));
    const link = await screen.findByRole('link', { name: employee.fullName });
    await user.click(link);
    await user.click(
      await within(screen.getByRole('main')).findByRole('link', { name: 'Users', exact: true }),
    );
    await waitFor(() => expect(view.location()).toContain('q=Amine'));
  });

  it('shows a newly created password once and then opens details', async () => {
    const password = 'Temp_password_42';
    const client = stub('director', {
      'POST /users': () => [201, { data: { user: employee, temporaryPassword: password } }],
    });
    const user = userEvent.setup();
    const view = renderApp('/app/users/new');
    await user.selectOptions(await screen.findByLabelText('Role'), 'animateur');
    await screen.findByRole('option', { name: supervisor.fullName });
    await user.selectOptions(screen.getByLabelText('Manager'), supervisor.id);
    await user.type(screen.getByLabelText('Full name'), employee.fullName);
    await user.type(screen.getByLabelText('Email'), employee.email);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByDisplayValue(password)).toBeInTheDocument();
    expect(client.calls.find((call) => call.key === 'POST /users').body).toMatchObject({
      role: 'animateur',
      managerId: supervisor.id,
    });
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(view.location()).toBe('/app/users/' + employee.id));
    expect(screen.queryByDisplayValue(password)).toBeNull();
  });

  it('requests only eligible manager roles in the transfer dialog', async () => {
    const managerQueries = [];
    stub('regional_manager', {
      'GET /users': ({ params }) => {
        managerQueries.push(params);
        return result(params.role === 'supervisor' ? [supervisor] : [employee]);
      },
    });
    const user = userEvent.setup();
    renderApp('/app/users/' + employee.id);
    await user.click(await screen.findByRole('button', { name: 'Transfer', exact: true }));
    await screen.findByRole('option', { name: supervisor.fullName });
    expect(screen.queryByRole('option', { name: employee.fullName })).toBeNull();
    expect(managerQueries).toEqual([{ q: '', role: 'supervisor', status: 'active' }]);
  });

  it('snapshots the Arabic user list and read-only supervisor navigation', async () => {
    await i18n.changeLanguage('ar');
    stub('supervisor');
    renderApp('/app/users');
    const table = await screen.findByRole('table');
    const nav = screen.getByRole('navigation');
    expect({
      direction: document.documentElement.dir,
      heading: within(screen.getByRole('main')).getByRole('heading').textContent,
      navigation: within(nav)
        .getAllByRole('link')
        .map((item) => item.textContent),
      headers: within(table)
        .getAllByRole('columnheader')
        .map((item) => item.textContent),
      cells: within(table)
        .getAllByRole('cell')
        .map((item) => item.textContent),
    }).toMatchInlineSnapshot(`
      {
        "cells": [
          "Amine Bensalem",
          "amine@example.dz",
          "منشط",
          "نشط",
          "19‏/11‏/2026",
        ],
        "direction": "rtl",
        "headers": [
          "الاسم الكامل ↑",
          "البريد الإلكتروني",
          "الدور",
          "الحالة",
          "تاريخ الإنشاء ↕",
        ],
        "heading": "المستخدمون",
        "navigation": [
          "المستخدمون",
          "الهيكل التنظيمي",
          "العملاء",
          "الحملات",
          "البلاغات",
          "الإعلانات",
        ],
      }
    `);
    expect(screen.queryByText('مستخدم جديد')).toBeNull();
    expect(within(nav).queryByText('نقاط البيع')).toBeNull();
    expect(within(nav).queryByText('المناطق')).toBeNull();
  });
});

it('loads cascading commune options and keeps an unsaved point edit after a version conflict', async () => {
  const id = '66111111-1111-4111-8111-111111111111';
  const path = '/points-of-sale/' + id;
  const client = stub('director', {
    ['GET ' + path]: () =>
      result({
        id,
        name: 'Original shop',
        code: 'P-1',
        type: 'Retail',
        wilayaId: 16,
        communeId: 101,
        version: 1,
      }),
    'GET /reference/wilayas': () =>
      result([
        { id: 16, nameEn: 'Algiers' },
        { id: 31, nameEn: 'Oran' },
      ]),
    'GET /reference/wilayas/16/communes': () => result([{ id: 101, nameEn: 'Algiers Centre' }]),
    'GET /reference/wilayas/31/communes': () => result([{ id: 201, nameEn: 'Oran Centre' }]),
    ['PATCH ' + path]: () => [
      409,
      { error: { code: 'VERSION_CONFLICT', message: 'stale version' } },
    ],
  });
  const user = userEvent.setup();
  renderApp('/app' + path);
  const place = await screen.findByLabelText('Wilaya');
  await screen.findByRole('option', { name: 'Algiers Centre' });
  await user.selectOptions(place, '31');
  const newCommune = await screen.findByRole('option', { name: 'Oran Centre' });
  await user.selectOptions(screen.getByLabelText('Commune'), newCommune);
  const name = screen.getByLabelText('Name', { exact: true });
  await user.clear(name);
  await user.type(name, 'Unsaved shop');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This record changed since you opened it.',
  );
  expect(name).toHaveValue('Unsaved shop');
  expect(client.calls.find((call) => call.key === 'PATCH ' + path).body).toMatchObject({
    wilayaId: 31,
    communeId: 201,
    version: 1,
  });
});
