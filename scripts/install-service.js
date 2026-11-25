import { loadEnv } from '../src/core/env.js';
import { ensureDataDirs } from '../src/core/paths.js';
import { enableAutostart } from '../src/core/autostart.js';

loadEnv();
ensureDataDirs();
const status = enableAutostart();
console.log('Autostart enabled:', status);
