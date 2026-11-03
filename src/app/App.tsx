import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, RuntimeProvider } from '@/core';
import { runtime } from './runtime';
import { AuthGate } from './auth/AuthGate';
import { AppShell } from './layout/AppShell';
import { modules } from './modules';
import { HomeScreen } from './screens/HomeScreen';
import { MoreScreen } from './screens/MoreScreen';
import { SystemScreen } from './screens/SystemScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TeamScreen } from './screens/TeamScreen';
import { EarningsScreen } from './screens/EarningsScreen';
import { PrivacyPage, TermsPage } from './screens/LegalPages';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="*" element={<Private />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Everything that needs a sign-in. */
function Private() {
  return (
    <AuthProvider>
      <AuthGate>
      <RuntimeProvider runtime={runtime}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomeScreen />} />
            {modules.map((m) => (
              <Route key={m.id} path={`${m.path}/*`} element={<m.Screen />} />
            ))}
            <Route path="/more" element={<MoreScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/earnings" element={<EarningsScreen />} />
            <Route path="/team" element={<TeamScreen />} />
            <Route path="/system" element={<SystemScreen />} />
            <Route path="*" element={<HomeScreen />} />
          </Route>
        </Routes>
      </RuntimeProvider>
      </AuthGate>
    </AuthProvider>
  );
}
