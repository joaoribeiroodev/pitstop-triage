import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { BoasVindasPageComponent } from '@pages/boas-vindas/boas-vindas-page.component';
import { ChatIaPageComponent } from '@pages/chat-ia/chat-ia-page.component';
import { MapaPageComponent } from '@pages/mapa/mapa-page.component';
import { PrivacidadePageComponent } from '@pages/privacidade/privacidade-page.component';
import { ResultadoPageComponent } from '@pages/resultado/resultado-page.component';
import { SintomasPageComponent } from '@pages/sintomas/sintomas-page.component';
import { VeiculoPageComponent } from '@pages/veiculo/veiculo-page.component';

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
