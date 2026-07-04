import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { LgpdConsentService } from '@services/lgpd-consent.service';

/** Etapas da triagem exigem consentimento LGPD prévio. */
export const requireLgpdConsentGuard: CanActivateFn = () => {
  const lgpd = inject(LgpdConsentService);
  if (lgpd.temConsentimento()) return true;
  return inject(Router).createUrlTree(['/inicio']);
};
