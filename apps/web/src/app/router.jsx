import { createBrowserRouter } from 'react-router';
import { GuestOnly, HomeRedirect, RequireSession, RequireSurface } from '../shared/auth/guards.jsx';
import { RouteError } from './RouteError.jsx';
import { RouteFallback } from './RouteFallback.jsx';

/**
 * Public: /login. Signed in: /change-password. Each surface is a separate lazy chunk behind its
 * guard: staff app, Animateur PWA, client portal (a user opening another surface is sent to theirs).
 */
export const routes = [
  {
    path: '/',
    HydrateFallback: RouteFallback,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: HomeRedirect },
      {
        Component: GuestOnly,
        children: [
          {
            path: 'login',
            lazy: async () => ({
              Component: (await import('../features/auth/pages/LoginPage.jsx')).LoginPage,
            }),
          },
        ],
      },
      {
        Component: RequireSession,
        children: [
          {
            path: 'change-password',
            lazy: async () => ({
              Component: (await import('../features/auth/pages/ChangePasswordPage.jsx'))
                .ChangePasswordPage,
            }),
          },
          {
            // Any signed-in user; the API decides per file (unauthorised ⇒ "not found").
            path: 'files/:id',
            lazy: async () => ({
              Component: (await import('../features/files/pages/FileViewerPage.jsx'))
                .FileViewerPage,
            }),
          },
        ],
      },
      {
        path: 'app',
        element: <RequireSurface surface="app" />,
        children: [
          {
            lazy: async () => ({ Component: (await import('./layouts/AppLayout.jsx')).AppLayout }),
            children: [
              {
                path: 'users',
                lazy: async () => ({
                  Component: (await import('../features/organization/pages/UsersPage.jsx'))
                    .UsersPage,
                }),
              },
              {
                path: 'users/new',
                lazy: async () => ({
                  Component: (await import('../features/organization/pages/NewUserPage.jsx'))
                    .NewUserPage,
                }),
              },
              {
                path: 'users/:id',
                lazy: async () => ({
                  Component: (await import('../features/organization/pages/UserDetailPage.jsx'))
                    .UserDetailPage,
                }),
              },
              {
                path: 'organization',
                lazy: async () => ({
                  Component: (await import('../features/organization/pages/OrganizationPage.jsx'))
                    .OrganizationPage,
                }),
              },
              {
                path: 'regions',
                lazy: async () => ({
                  Component: (await import('../features/organization/pages/RegionsPage.jsx'))
                    .RegionsPage,
                }),
              },
              {
                path: 'points-of-sale',
                lazy: async () => ({
                  Component: (await import('../features/points-of-sale/pages/PointsPage.jsx'))
                    .PointsPage,
                }),
              },
              {
                path: 'points-of-sale/new',
                lazy: async () => ({
                  Component: (await import('../features/points-of-sale/pages/PointPage.jsx'))
                    .PointPage,
                }),
              },
              {
                path: 'points-of-sale/:id',
                lazy: async () => ({
                  Component: (await import('../features/points-of-sale/pages/PointPage.jsx'))
                    .PointPage,
                }),
              },
              {
                path: 'clients',
                lazy: async () => ({
                  Component: (await import('../features/catalog/pages/ClientsPage.jsx'))
                    .ClientsPage,
                }),
              },
              {
                path: 'clients/:id',
                lazy: async () => ({
                  Component: (await import('../features/catalog/pages/ClientDetailPage.jsx'))
                    .ClientDetailPage,
                }),
              },
              {
                path: 'issues',
                lazy: async () => ({
                  Component: (await import('../features/issues/IssuesPage.jsx')).IssuesPage,
                }),
              },
              {
                path: 'issues/:id',
                lazy: async () => ({
                  Component: (await import('../features/issues/IssueDetailPage.jsx'))
                    .IssueDetailPage,
                }),
              },
              {
                path: 'announcements',
                lazy: async () => ({
                  Component: (await import('../features/announcements/AnnouncementsPage.jsx'))
                    .AnnouncementsPage,
                }),
              },
              {
                path: 'announcements/:id',
                lazy: async () => ({
                  Component: (await import('../features/announcements/AnnouncementsPage.jsx'))
                    .AnnouncementDetailPage,
                }),
              },
              {
                path: 'notifications',
                lazy: async () => ({
                  Component: (await import('../features/notifications/NotificationsPage.jsx'))
                    .NotificationsPage,
                }),
              },
              {
                path: 'attendance',
                lazy: async () => ({
                  Component: (await import('../features/attendance/ReviewPage.jsx')).ReviewPage,
                }),
              },
              {
                path: 'my-stock',
                lazy: async () => ({
                  Component: (await import('../features/inventory/MyStockPage.jsx')).MyStockPage,
                }),
              },
              {
                path: 'campaigns/:id/client-preview',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalCampaign.jsx'))
                    .PortalCampaignPreview,
                }),
              },
              {
                path: 'campaigns/:id/client-preview/report',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalCampaign.jsx'))
                    .PortalCampaignPreviewReport,
                }),
              },
              {
                path: 'tombolas/:id',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalTombola.jsx')).StaffTombola,
                }),
              },
              {
                path: 'tombolas/:id/record',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/TombolaRecord.jsx'))
                    .StaffTombolaRecord,
                }),
              },
              {
                path: 'ai-review',
                lazy: async () => ({
                  Component: (await import('../features/ai/AiReviewPage.jsx')).AiReviewPage,
                }),
              },
              {
                path: 'ai-review/:id',
                lazy: async () => ({
                  Component: (await import('../features/ai/AiReviewPage.jsx')).AiReviewPage,
                }),
              },
              {
                path: 'approvals',
                lazy: async () => ({
                  Component: (await import('../features/assignments/ApprovalsPage.jsx'))
                    .ApprovalsPage,
                }),
              },
              {
                path: 'campaigns',
                lazy: async () => ({
                  Component: (await import('../features/campaigns/pages/CampaignsPage.jsx'))
                    .CampaignsPage,
                }),
              },
              {
                path: 'campaigns/new',
                lazy: async () => ({
                  Component: (await import('../features/campaigns/pages/NewCampaignPage.jsx'))
                    .NewCampaignPage,
                }),
              },
              {
                path: 'dashboard',
                lazy: async () => ({
                  Component: (await import('../features/reporting/Dashboard.jsx')).Dashboard,
                }),
              },
              {
                path: 'campaigns/:id/report',
                lazy: async () => ({
                  Component: (await import('../features/reporting/CampaignReport.jsx'))
                    .CampaignReport,
                }),
              },
              {
                path: 'campaigns/:id',
                lazy: async () => ({
                  Component: (await import('../features/campaigns/pages/CampaignDetailPage.jsx'))
                    .CampaignDetailPage,
                }),
              },
              // Component kit review page: development builds only (dead-code-eliminated in production).
              ...(import.meta.env.DEV
                ? [
                    {
                      path: '_design',
                      lazy: async () => ({
                        Component: (await import('../ui/DesignPage.jsx')).DesignPage,
                      }),
                    },
                  ]
                : []),
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../features/system/pages/SystemStatusPage.jsx'))
                    .SystemStatusPage,
                }),
              },
            ],
          },
        ],
      },
      {
        path: 'field',
        element: <RequireSurface surface="field" />,
        children: [
          {
            lazy: async () => ({
              Component: (await import('./layouts/FieldLayout.jsx')).FieldLayout,
            }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../surfaces/field/Today.jsx')).Today,
                }),
              },
              {
                path: 'attendance',
                lazy: async () => ({
                  Component: (await import('../surfaces/field/Attendance.jsx')).Attendance,
                }),
              },
              {
                path: 'sale',
                lazy: async () => ({
                  Component: (await import('../surfaces/field/Sale.jsx')).Sale,
                }),
              },
              {
                path: 'issue',
                lazy: async () => ({
                  Component: (await import('../surfaces/field/Issue.jsx')).Issue,
                }),
              },
            ],
          },
        ],
      },
      {
        path: 'portal',
        element: <RequireSurface surface="portal" />,
        children: [
          {
            lazy: async () => ({
              Component: (await import('./layouts/PortalLayout.jsx')).PortalLayout,
            }),
            children: [
              {
                index: true,
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalCampaigns.jsx'))
                    .PortalCampaigns,
                }),
              },
              {
                path: 'campaigns/:id',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalCampaign.jsx')).PortalCampaign,
                }),
              },
              {
                path: 'campaigns/:id/report',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalCampaign.jsx'))
                    .PortalCampaignReport,
                }),
              },
              {
                path: 'tombolas/:id',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/PortalTombola.jsx')).PortalTombola,
                }),
              },
              {
                path: 'tombolas/:id/record',
                lazy: async () => ({
                  Component: (await import('../surfaces/portal/TombolaRecord.jsx')).TombolaRecord,
                }),
              },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
