import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BoasVindasPageComponent } from '@components/boas-vindas/boas-vindas-page.component';
import { ChatIaPageComponent } from '@components/chat-ia/chat-ia-page.component';
import { MapaPageComponent } from '@components/mapa/mapa-page.component';
import { PrivacidadePageComponent } from '@components/privacidade/privacidade-page.component';
import { ResultadoPageComponent } from '@components/resultado/resultado-page.component';
import { SintomasPageComponent } from '@components/sintomas/sintomas-page.component';
import { VeiculoPageComponent } from '@components/veiculo/veiculo-page.component';
import { SharedModule } from '@modules/shared.module';

@NgModule({
  declarations: [
    BoasVindasPageComponent,
    PrivacidadePageComponent,
    VeiculoPageComponent,
    MapaPageComponent,
    SintomasPageComponent,
    ChatIaPageComponent,
    ResultadoPageComponent
  ],
  imports: [CommonModule, FormsModule, RouterModule, SharedModule]
})
export class PagesModule {}
