import { Routes } from '@angular/router';
import {
  requireRefinamentoGuard,
  requireSintomasGuard,
  requireVeiculoGuard,
  requireZonaGuard
} from '@core/guards/triage.guards';
import { requireLgpdConsentGuard } from '@core/guards/lgpd.guards';
import { BoasVindasPageComponent } from '@pages/boas-vindas/boas-vindas-page.component';
import { ChatIaPageComponent } from '@pages/chat-ia/chat-ia-page.component';
import { MapaPageComponent } from '@pages/mapa/mapa-page.component';
import { PrivacidadePageComponent } from '@pages/privacidade/privacidade-page.component';
import { ResultadoPageComponent } from '@pages/resultado/resultado-page.component';
import { SintomasPageComponent } from '@pages/sintomas/sintomas-page.component';
import { VeiculoPageComponent } from '@pages/veiculo/veiculo-page.component';

export const PAGES_ROUTES: Routes = [
  { path: 'inicio', component: BoasVindasPageComponent, title: 'Início | PitStop Triage' },
  { path: 'privacidade', component: PrivacidadePageComponent, title: 'Privacidade | PitStop Triage' },
  {
    path: 'veiculo',
    component: VeiculoPageComponent,
    title: 'Veiculo | PitStop Triage',
    canActivate: [requireLgpdConsentGuard]
  },
  {
    path: 'mapa',
    component: MapaPageComponent,
    title: 'Mapa | PitStop Triage',
    canActivate: [requireLgpdConsentGuard, requireVeiculoGuard]
  },
  {
    path: 'sintomas',
    component: SintomasPageComponent,
    title: 'Sintomas | PitStop Triage',
    canActivate: [requireLgpdConsentGuard, requireZonaGuard]
  },
  {
    path: 'chat-ia',
    component: ChatIaPageComponent,
    title: 'Refinamento IA | PitStop Triage',
    canActivate: [requireLgpdConsentGuard, requireSintomasGuard]
  },
  {
    path: 'resultado',
    component: ResultadoPageComponent,
    title: 'Resultado | PitStop Triage',
    canActivate: [requireLgpdConsentGuard, requireRefinamentoGuard]
  }
];
