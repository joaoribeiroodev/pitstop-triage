import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { RouterModule } from '@angular/router';
import { Car3dComponent } from '@components/car-3d/car-3d.component';
import { LgpdNoticeComponent } from '@components/lgpd-notice/lgpd-notice.component';

@NgModule({
  declarations: [Car3dComponent, LgpdNoticeComponent],
  imports: [CommonModule, RouterModule],
  exports: [Car3dComponent, LgpdNoticeComponent]
})
export class SharedModule {}
