import { Routes } from '@angular/router';
import { Landing } from './pages/landing/landing';
import { Vault } from './pages/vault/vault';
import { Guide } from './pages/guide/guide';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'vault', component: Vault },
  { path: 'guide', component: Guide },
  { path: '**', redirectTo: '' },
];
