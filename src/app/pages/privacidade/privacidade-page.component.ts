import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  POLITICA_PRIVACIDADE_SECOES,
  POLITICA_PRIVACIDADE_VERSAO,
  CONTROLADOR_DADOS
} from '@core/constants/lgpd.constants';

@Component({
  selector: 'app-privacidade-page',
  standalone: false,
  templateUrl: './privacidade-page.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PrivacidadePageComponent {
  readonly secoes = POLITICA_PRIVACIDADE_SECOES;
  readonly versao = POLITICA_PRIVACIDADE_VERSAO;
  readonly controlador = CONTROLADOR_DADOS;
}
