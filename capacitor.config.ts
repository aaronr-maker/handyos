import type { CapacitorConfig } from '@capacitor/cli';
import { appConfig } from './src/config/app';

/**
 * Capacitor wraps the built web app (dist/) for the App Store / Google Play.
 * Native projects are NOT generated yet. When ready:
 *   npm run build && npx cap add ios && npx cap add android && npx cap sync
 */
const config: CapacitorConfig = {
  appId: appConfig.bundleId,
  appName: appConfig.name,
  webDir: 'dist',
};

export default config;
