import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';
import AppointmentBoardPage from './pages/AppointmentBoardPage';
import AppointmentCreatePage from './pages/AppointmentCreatePage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import PetDetailPage from './pages/PetDetailPage';
import PetFormPage from './pages/PetFormPage';

export default function App() {
  const { authReady, user } = useAuth();

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-100">
        <div className="glass-panel rounded-3xl px-6 py-4 text-sm font-medium text-slate-700 shadow-glow">
          Loading Pawsitively Perfect...
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/app" replace /> : <LoginPage />}
      />
      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="pets/new" element={<PetFormPage mode="create" />} />
        <Route path="pets/:petId" element={<PetDetailPage />} />
        <Route path="pets/:petId/edit" element={<PetFormPage mode="edit" />} />
        <Route path="appointments/new" element={<AppointmentCreatePage />} />
        <Route path="appointments/board" element={<AppointmentBoardPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
      <Route path="/" element={<Navigate to={user ? '/app' : '/login'} replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
