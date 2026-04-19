import axios, { type AxiosError } from 'axios';

const API_KEY_STORAGE_KEY = 'billr_api_key';

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach Bearer token from localStorage on every request
api.interceptors.request.use((config) => {
  const key = getStoredApiKey();
  if (key) {
    config.headers.Authorization = `Bearer ${key}`;
  }
  return config;
});

// Redirect to /login on 401 (token expired or invalid)
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      clearStoredApiKey();
      // Avoid redirect loop if already on /login
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export default api;
