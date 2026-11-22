import { environment as base } from './environment.prod';
export const environment = {
  ...base,
  production: false,
  useEmulators: true,
  directBooking: false,
  firebase: {
    ...base.firebase,
    projectId: 'demo-grassgo',
    apiKey: 'demo-key',
    authDomain: 'localhost',
    storageBucket: 'demo-grassgo.firebasestorage.app',
  },
};
