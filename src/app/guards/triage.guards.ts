import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TriageStateService } from '@services/triage-state.service';

function redirectVeiculo(): ReturnType<CanActivateFn> {
  return inject(Router).createUrlTree(['/veiculo']);
}

function redirectMapa(): ReturnType<CanActivateFn> {
  return inject(Router).createUrlTree(['/mapa']);
}

function redirectSintomas(): ReturnType<CanActivateFn> {
  return inject(Router).createUrlTree(['/sintomas']);
}

function redirectChat(): ReturnType<CanActivateFn> {
  return inject(Router).createUrlTree(['/chat-ia']);
}

/** Etapa 2+: veículo identificado */
export const requireVeiculoGuard: CanActivateFn = () => {
  const state = inject(TriageStateService);
  return state.podeAcessarEtapa('/mapa') ? true : redirectVeiculo();
};

/** Etapa 3+: zona selecionada no mapa */
export const requireZonaGuard: CanActivateFn = () => {
  const state = inject(TriageStateService);
  if (!state.podeAcessarEtapa('/mapa')) return redirectVeiculo();
  return state.podeAcessarEtapa('/sintomas') ? true : redirectMapa();
};

/** Etapa 4+: ao menos um sintoma marcado */
export const requireSintomasGuard: CanActivateFn = () => {
  const state = inject(TriageStateService);
  if (!state.podeAcessarEtapa('/mapa')) return redirectVeiculo();
  if (!state.podeAcessarEtapa('/sintomas')) return redirectMapa();
  return state.podeAcessarEtapa('/chat-ia') ? true : redirectSintomas();
};

/** Etapa 5: triagem completa + refinamento respondido */
export const requireRefinamentoGuard: CanActivateFn = () => {
  const state = inject(TriageStateService);
  if (!state.podeAcessarEtapa('/mapa')) return redirectVeiculo();
  if (!state.podeAcessarEtapa('/sintomas')) return redirectMapa();
  if (!state.podeAcessarEtapa('/chat-ia')) return redirectSintomas();
  return state.podeAcessarEtapa('/resultado') ? true : redirectChat();
};
