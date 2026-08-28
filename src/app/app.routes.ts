import type { Routes } from '@angular/router';

// The root shell owns authentication and onboarding. These componentless routes make `/pair`
// addressable before a device token exists without putting it behind an auth redirect.
export const routes: Routes = [
  { path: '', pathMatch: 'full', children: [] },
  { path: 'pair', children: [] },
  { path: '**', redirectTo: '' },
];
