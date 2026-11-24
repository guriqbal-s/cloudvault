import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

// Provider order matters: Theme (no deps) -> Toast -> Auth (uses Theme) -> Notifications live inside AppLayout (need Auth + Toast).
export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
