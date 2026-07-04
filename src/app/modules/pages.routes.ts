import { Routes } from '@angular/router';
import {
  requireRefinamentoGuard,
  requireSintomasGuard,
  requireVeiculoGuard,
  requireZonaGuard
} from '@guards/triage.guards';
import { requireLgpdConsentGuard } from '@guards/lgpd.guards';
import { BoasVindasPageComponent } from '@components/boas-vindas/boas-vindas-page.component';
import { ChatIaPageComponent } from '@components/chat-ia/chat-ia-page.component';
import { MapaPageComponent } from '@components/mapa/mapa-page.component';
import { PrivacidadePageComponent } from '@components/privacidade/privacidade-page.component';
import { ResultadoPageComponent } from '@components/resultado/resultado-page.component';
import { SintomasPageComponent } from '@components/sintomas/sintomas-page.component';
import { VeiculoPageComponent } from '@components/veiculo/veiculo-page.component';

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
