import { Routes } from '@angular/router';
import { authGuard, featureFlagGuard, roleGuard } from '@front/core';

export const routes: Routes = [
  // públicas
  { path: 'login', loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage) },
  { path: 'recuperar-senha', loadComponent: () => import('./pages/account.page').then((m) => m.ForgotPasswordPage) },
  { path: 'definir-senha/:token', loadComponent: () => import('./pages/account.page').then((m) => m.SetPasswordPage) },
  { path: 'bloqueado', loadComponent: () => import('./pages/login.page').then((m) => m.BlockedPage) },
  { path: 'suporte', loadComponent: () => import('./pages/login.page').then((m) => m.SupportSessionPage) },
  { path: 'portal/:token', loadComponent: () => import('./pages/portal.page').then((m) => m.PortalPage) },
  { path: 'triagem/:slug', loadComponent: () => import('./pages/public-triage.page').then((m) => m.PublicTriagePage) },
  { path: 'privacidade', loadComponent: () => import('./pages/portal.page').then((m) => m.PrivacyPage) },

  // app da oficina
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./ui/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'customers', loadComponent: () => import('./pages/customers.page').then((m) => m.CustomersPage) },
      { path: 'customers/:id', loadComponent: () => import('./pages/customers.page').then((m) => m.CustomerDetailPage) },
      { path: 'vehicles', loadComponent: () => import('./pages/vehicles.page').then((m) => m.VehiclesPage) },
      { path: 'vehicles/:id', loadComponent: () => import('./pages/vehicles.page').then((m) => m.VehicleDetailPage) },
      {
        path: 'triage',
        canActivate: [featureFlagGuard('triage')],
        children: [
          { path: '', loadComponent: () => import('./pages/triage.page').then((m) => m.TriageListPage) },
          {
            path: 'new',
            canActivate: [roleGuard('owner', 'manager', 'receptionist')],
            loadComponent: () => import('./pages/triage.page').then((m) => m.TriageWizardPage)
          },
          { path: ':id', loadComponent: () => import('./pages/triage.page').then((m) => m.TriageDetailPage) }
        ]
      },
      { path: 'service-orders', loadComponent: () => import('./pages/orders-board.page').then((m) => m.OrdersBoardPage) },
      {
        path: 'service-orders/new',
        canActivate: [roleGuard('owner', 'manager', 'receptionist')],
        loadComponent: () => import('./pages/orders-board.page').then((m) => m.NewOrderPage)
      },
      { path: 'service-orders/:id', loadComponent: () => import('./pages/order-detail.page').then((m) => m.OrderDetailPage) },
      { path: 'quotes/:id', loadComponent: () => import('./pages/quote.page').then((m) => m.QuotePage) },
      { path: 'settings', loadComponent: () => import('./pages/settings.page').then((m) => m.SettingsPage) },
      { path: 'settings/users', canActivate: [roleGuard('owner')], loadComponent: () => import('./pages/settings.page').then((m) => m.UsersPage) },
      { path: 'settings/catalog', loadComponent: () => import('./pages/settings.page').then((m) => m.CatalogPage) },
      {
        path: 'settings/notifications',
        canActivate: [featureFlagGuard('whatsapp')],
        loadComponent: () => import('./pages/settings.page').then((m) => m.NotificationsSettingsPage)
      },
      // módulos por plano: a rota só existe quando o módulo está ativo no tenant
      { path: 'schedule', canActivate: [featureFlagGuard('schedule')], loadComponent: () => import('./pages/schedule.page').then((m) => m.SchedulePage) },
      { path: 'inventory', canActivate: [featureFlagGuard('inventory')], loadComponent: () => import('./pages/inventory.page').then((m) => m.InventoryPage) },
      {
        path: 'financial',
        canActivate: [featureFlagGuard('financial'), roleGuard('owner', 'manager')],
        loadComponent: () => import('./pages/financial.page').then((m) => m.FinancialPage)
      },
      { path: 'reports', canActivate: [roleGuard('owner', 'manager')], loadComponent: () => import('./pages/reports.page').then((m) => m.ReportsPage) }
    ]
  },
  { path: '**', redirectTo: '' }
];
