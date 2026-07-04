import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { PAGES_ROUTES } from '@modules/pages.routes';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'inicio' },
  ...PAGES_ROUTES,
  { path: '**', redirectTo: 'inicio' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { scrollPositionRestoration: 'top' })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
