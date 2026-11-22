import { Routes, CanDeactivateFn } from '@angular/router';
import { adminGuard, authGuard, superadminGuard } from './core/auth/auth.guards';

const leavePlatform: CanDeactivateFn<{ canLeavePage(): boolean }> = (component) =>
  component.canLeavePage();

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'ingresar',
    pathMatch: 'full',
  },
  {
    path: 'inicio',
    canActivate: [authGuard],
    loadComponent: () => import('./features/booking/customer-home').then((m) => m.CustomerHome),
  },
  {
    path: 'sedes',
    canActivate: [authGuard],
    loadComponent: () => import('./features/booking/venues').then((m) => m.Venues),
  },
  {
    path: 'sedes/piloto',
    redirectTo: 'sedes/el-puma/canchas',
    pathMatch: 'full',
  },
  {
    path: 'sedes/:establishmentId/canchas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/booking/courts').then((m) => m.Courts),
  },
  {
    path: 'reservar/:establishmentId/:courtId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/booking/booking-flow').then((m) => m.BookingFlow),
  },
  {
    path: 'admin/ingresar',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'login', portal: 'admin' },
  },
  {
    path: 'superadmin/ingresar',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'login', portal: 'superadmin' },
  },
  {
    path: 'superadmin/recuperar',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'reset', portal: 'superadmin' },
  },
  {
    path: 'ingresar',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'login' },
  },
  {
    path: 'registro',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'register' },
  },
  {
    path: 'recuperar',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    data: { mode: 'reset' },
  },
  {
    path: 'perfil',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
  },
  {
    path: 'invitaciones',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/platform/business-invitations').then((m) => m.BusinessInvitations),
  },
  {
    path: 'reservas',
    canActivate: [authGuard],
    loadComponent: () => import('./features/booking/my-reservations').then((m) => m.MyReservations),
  },
  {
    path: 'gestion',
    redirectTo: 'admin/inicio',
    pathMatch: 'full',
  },
  {
    path: 'plataforma',
    redirectTo: 'superadmin/inicio',
    pathMatch: 'full',
  },
  {
    path: 'admin/inicio',
    canActivate: [authGuard, adminGuard],
    canDeactivate: [(component: { canLeavePage(): boolean }) => component.canLeavePage()],
    loadComponent: () => import('./features/staff/staff-dashboard').then((m) => m.StaffDashboard),
    data: { portal: 'admin' },
  },
  {
    path: 'superadmin/inicio',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'resumen' },
  },
  {
    path: 'superadmin/negocios/nuevo',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'nuevo' },
  },
  {
    path: 'superadmin/negocios',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'negocios' },
  },
  {
    path: 'superadmin/actividad',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'actividad' },
  },
  {
    path: 'superadmin/configuracion',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'configuracion' },
  },
  {
    path: 'superadmin/negocios/:establishmentId/configurar',
    canActivate: [authGuard, superadminGuard],
    canDeactivate: [leavePlatform],
    loadComponent: () =>
      import('./features/platform/platform-dashboard').then((m) => m.PlatformDashboard),
    data: { section: 'nuevo' },
  },
  { path: 'superadmin', redirectTo: 'superadmin/inicio', pathMatch: 'full' },
  { path: 'superadmin', children: [{ path: '**', redirectTo: 'inicio' }] },
  { path: 'index.html', redirectTo: 'ingresar', pathMatch: 'full' },
  { path: 'perfil.html', redirectTo: 'perfil', pathMatch: 'full' },
  { path: 'registro.html', redirectTo: 'registro', pathMatch: 'full' },
  { path: 'canchas.html', redirectTo: 'inicio', pathMatch: 'full' },
  { path: 'sedes.html', redirectTo: 'sedes', pathMatch: 'full' },
  { path: 'cancha-el-puma.html', redirectTo: 'sedes/piloto', pathMatch: 'full' },
  {
    path: '**',
    loadComponent: () => import('./features/workspace/workspace').then((m) => m.Workspace),
    data: { area: 'notfound' },
  },
];
