import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-guide',
  imports: [RouterLink],
  templateUrl: './guide.html',
  styleUrl: './guide.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Guide {}
