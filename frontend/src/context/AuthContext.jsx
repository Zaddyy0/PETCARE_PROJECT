import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchCurrentUser, loginUser, registerUser } from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('petcare_token'));
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadUser() {
      if (!token) {
        setAuthReady(true);
        return;
      }

      try {
        const response = await fetchCurrentUser();
        if (isMounted) {
          setUser(response.data);
        }
      } catch (error) {
        localStorage.removeItem('petcare_token');
        setToken(null);
        setUser(null);
      } finally {
        if (isMounted) {
          setAuthReady(true);
        }
      }
    }

    loadUser();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const login = async (credentials) => {
    setAuthError('');
    const response = await loginUser(credentials);
    localStorage.setItem('petcare_token', response.data.token);
    setToken(response.data.token);
    setUser(response.data.user);
    return response;
  };

  const register = async (credentials) => {
    setAuthError('');
    const response = await registerUser(credentials);
    localStorage.setItem('petcare_token', response.data.token);
    setToken(response.data.token);
    setUser(response.data.user);
    return response;
  };

  const logout = () => {
    localStorage.removeItem('petcare_token');
    setToken(null);
    setUser(null);
  };

  const value = useMemo(() => ({
    user,
    token,
    authReady,
    authError,
    setAuthError,
    login,
    register,
    logout
  }), [user, token, authReady, authError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
