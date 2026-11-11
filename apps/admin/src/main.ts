import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { inject, provideAppInitializer, provideExperimentalZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { apiInterceptor, AuthService, ignoreHandledApiRejections, SESSION_KEY } from '@front/core';
import { AppComponent, routes } from './app/app';

ignoreHandledApiRejections();

bootstrapApplication(AppComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideHttpClient(withInterceptors([apiInterceptor])),
    { provide: SESSION_KEY, useValue: 'pitstop.admin.sessao' },
    provideAppInitializer(() => inject(AuthService).restore())
  ]
}).catch((error) => console.error(error));
