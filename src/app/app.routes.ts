import { Routes } from '@angular/router';
import { Landing } from './pages/landing/landing';
import { Vault } from './pages/vault/vault';

export const routes: Routes = [
  { path: '', component: Landing },
  { path: 'vault', component: Vault },
  { path: '**', redirectTo: '' },
];
