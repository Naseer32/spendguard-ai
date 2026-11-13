import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layout/AppLayout.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import AgentDetailPage from './pages/AgentDetailPage.jsx';
import AgentsPage from './pages/AgentsPage.jsx';
import ApprovalsPage from './pages/ApprovalsPage.jsx';
import LandingPage from './pages/LandingPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import PaymentRequestsPage from './pages/PaymentRequestsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { DataStoreProvider } from './state/DataStore.jsx';
import { SettingsProvider } from './state/Settings.jsx';
import { ToastProvider } from './state/Toasts.jsx';

export default function App() {
  return (
    <SettingsProvider>
      <DataStoreProvider>
        <ToastProvider>
          <Routes>
            <Route index element={<LandingPage />} />
            <Route path="landing" element={<Navigate to="/" replace />} />
            <Route element={<AppLayout />}>
              <Route path="overview" element={<OverviewPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="agents/:agentId" element={<AgentDetailPage />} />
              <Route path="payment-requests" element={<PaymentRequestsPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/overview" replace />} />
            </Route>
          </Routes>
        </ToastProvider>
      </DataStoreProvider>
    </SettingsProvider>
  );
}
