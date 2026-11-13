import { Navigate } from 'react-router-dom';
import { modules } from '../modules';
import { HomeScreen } from './HomeScreen';

/** Where the app opens: the Dashboard for everyone. If that section is switched off, the old home page of tiles is used. */
export function Landing() {
  return modules.some((m) => m.id === 'today') ? <Navigate to="/dashboard" replace /> : <HomeScreen />;
}
