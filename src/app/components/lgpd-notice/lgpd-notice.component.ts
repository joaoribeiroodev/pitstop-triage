import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-lgpd-notice',
  standalone: false,
  templateUrl: './lgpd-notice.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LgpdNoticeComponent {
  @Input({ required: true }) mensagem!: string;
}
