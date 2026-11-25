import path from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './paths.js';

export function loadEnv() {
  dotenv.config({ path: path.join(ROOT, '.env') });
}
