import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PAGES_ROUTES } from '@pages/pages.routes';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'veiculo' },
  ...PAGES_ROUTES,
  { path: '**', redirectTo: 'veiculo' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top' })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
