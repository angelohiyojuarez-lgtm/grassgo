import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { AccessService } from './access.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready;
  return auth.user()
    ? true
    : router.createUrlTree(
        [
          state.url.startsWith('/superadmin/')
            ? '/superadmin/ingresar'
            : state.url.startsWith('/admin/')
              ? '/admin/ingresar'
              : '/ingresar',
        ],
        { queryParams: { next: state.url } },
      );
};
export const superadminGuard: CanActivateFn = async () => {
  const access = inject(AccessService);
  const router = inject(Router);
  try {
    return (
      (await access.isSuperadmin()) ||
      router.createUrlTree(['/superadmin/ingresar'], { queryParams: { access: 'denied' } })
    );
  } catch {
    return router.createUrlTree(['/superadmin/ingresar'], {
      queryParams: { access: 'unavailable' },
    });
  }
};
export const adminGuard: CanActivateFn = async () => {
  const access = inject(AccessService);
  const router = inject(Router);
  try {
    return (
      (await access.memberships()).length > 0 ||
      router.createUrlTree(['/admin/ingresar'], { queryParams: { access: 'denied' } })
    );
  } catch {
    return router.createUrlTree(['/admin/ingresar'], { queryParams: { access: 'unavailable' } });
  }
};
