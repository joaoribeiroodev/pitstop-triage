import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FeedbackComponent } from '@front/ui';

@Component({
  selector: 'ps-root',
  standalone: true,
  imports: [RouterOutlet, FeedbackComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<router-outlet /><ps-feedback />`
})
export class AppComponent {}
