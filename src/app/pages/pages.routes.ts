import { Routes } from '@angular/router';
import {
  requireRefinamentoGuard,
  requireSintomasGuard,
  requireVeiculoGuard,
  requireZonaGuard
} from '@core/guards/triage.guards';
import { ChatIaPageComponent } from '@pages/chat-ia/chat-ia-page.component';
import { MapaPageComponent } from '@pages/mapa/mapa-page.component';
import { ResultadoPageComponent } from '@pages/resultado/resultado-page.component';
import { SintomasPageComponent } from '@pages/sintomas/sintomas-page.component';
import { VeiculoPageComponent } from '@pages/veiculo/veiculo-page.component';

export const PAGES_ROUTES: Routes = [
  { path: 'veiculo', component: VeiculoPageComponent, title: 'Veiculo | PitStop Triage' },
  {
    path: 'mapa',
    component: MapaPageComponent,
    title: 'Mapa | PitStop Triage',
    canActivate: [requireVeiculoGuard]
  },
  {
    path: 'sintomas',
    component: SintomasPageComponent,
    title: 'Sintomas | PitStop Triage',
    canActivate: [requireZonaGuard]
  },
  {
    path: 'chat-ia',
    component: ChatIaPageComponent,
    title: 'Refinamento IA | PitStop Triage',
    canActivate: [requireSintomasGuard]
  },
  {
    path: 'resultado',
    component: ResultadoPageComponent,
    title: 'Resultado | PitStop Triage',
    canActivate: [requireRefinamentoGuard]
  }
];
