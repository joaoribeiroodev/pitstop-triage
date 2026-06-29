import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { Car3dComponent } from '@shared/components/car-3d/car-3d.component';

@NgModule({
  declarations: [Car3dComponent],
  imports: [CommonModule],
  exports: [Car3dComponent]
})
export class SharedModule {}
