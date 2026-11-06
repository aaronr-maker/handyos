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
  // the phone app shows the live app, so it is always the latest version and needs no reinstall for updates
  server: { url: 'https://app.thathandymanvan.com', androidScheme: 'https' },
};

export default config;
