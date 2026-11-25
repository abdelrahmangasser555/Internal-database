import { loadEnv } from '../src/core/env.js';
import { disableAutostart } from '../src/core/autostart.js';

loadEnv();
const status = disableAutostart();
console.log('Autostart disabled:', status);
