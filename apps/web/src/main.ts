import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { inject, isDevMode, provideAppInitializer, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { apiInterceptor, AuthService, ignoreHandledApiRejections, SESSION_KEY } from '@front/core';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';

ignoreHandledApiRejections();

bootstrapApplication(AppComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(withInterceptors([apiInterceptor])),
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    { provide: SESSION_KEY, useValue: 'pitstop.oficina.sessao' },
    provideAppInitializer(() => inject(AuthService).restore())
  ]
}).catch((error) => console.error(error));
