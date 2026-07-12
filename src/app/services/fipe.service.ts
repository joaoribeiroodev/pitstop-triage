import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { FipeAno, FipeMarca, FipeModelo, FipeValor } from '@models/fipe.model';
import { formatarAnoFipe } from '@utils/fipe.util';

@Injectable({ providedIn: 'root' })
export class FipeService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'https://parallelum.com.br/fipe/api/v1/carros';

  listarMarcas(): Observable<FipeMarca[]> {
    return this.http.get<FipeMarca[]>(`${this.baseUrl}/marcas`);
  }

  listarModelos(marcaCodigo: string): Observable<FipeModelo[]> {
    return this.http
      .get<{ modelos: FipeModelo[] }>(`${this.baseUrl}/marcas/${marcaCodigo}/modelos`)
      .pipe(map((res) => res.modelos));
  }

  listarAnos(marcaCodigo: string, modeloCodigo: string): Observable<FipeAno[]> {
    return this.http
      .get<FipeAno[]>(`${this.baseUrl}/marcas/${marcaCodigo}/modelos/${modeloCodigo}/anos`)
      .pipe(map((anos) => anos.map((ano) => ({ ...ano, nome: formatarAnoFipe(ano.nome) }))));
  }

  consultarValor(marcaCodigo: string, modeloCodigo: string, anoCodigo: string): Observable<FipeValor> {
    return this.http.get<FipeValor>(
      `${this.baseUrl}/marcas/${marcaCodigo}/modelos/${modeloCodigo}/anos/${anoCodigo}`
    );
  }
}

export type { FipeAno, FipeMarca, FipeModelo, FipeValor } from '@models/fipe.model';
