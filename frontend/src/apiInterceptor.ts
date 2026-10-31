import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";

const getApiBaseUrl = (): string => {
  const envUrl = (import.meta.env.VITE_API_URL || "").trim();
  if (typeof window !== "undefined") {
    // If running over HTTPS in production, prevent Mixed Content and CORS issues
    // by falling back to same-origin (Kong handles both frontend and backend)
    if (window.location.protocol === "https:" && (!envUrl || envUrl.startsWith("http://"))) {
      return window.location.origin;
    }
  }
  return (envUrl || "http://localhost:3001").replace(/\/+$/u, "");
};

const apiBaseUrl = getApiBaseUrl();

const apiBasePath = `${apiBaseUrl}/v1`;
const authBasePath = `${apiBasePath}/auth`;

// Axios Instances
export const appApi = axios.create({
  baseURL: apiBasePath,
  withCredentials: true,
});

const api = axios.create({
  baseURL: authBasePath,
  withCredentials: true,
});

// Dedicated refresh client without interceptors
const refreshClient = axios.create({
  baseURL: authBasePath,
  withCredentials: true,
});

let isRefreshing = false;

let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

type RetryableRequestConfig = AxiosRequestConfig & {
  _retry?: boolean;
  skipRefresh?: boolean;
};

const processQueue = (
  error: unknown,
  token: string | null = null
) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else {
      promise.resolve(token);
    }
  });

  failedQueue = [];
};

// ============================================================================
// Access Token with memory & sessionStorage synchronization
// ============================================================================

const TOKEN_STORAGE_KEY = "uf_access_token";

let accessToken: string | null = (() => {
  if (typeof window !== "undefined") {
    try {
      return sessionStorage.getItem(TOKEN_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }
  return null;
})();

export const setAccessToken = (token: string | null) => {
  accessToken = token;
  if (typeof window !== "undefined") {
    try {
      if (token) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }
};

export const clearAccessToken = () => {
  accessToken = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
};

export const getAccessToken = () => accessToken;

export async function refreshAccessToken(): Promise<string> {
  const response = await refreshClient.post<{
    success?: boolean;
    accessToken?: string;
    data?: {
      accessToken?: string;
      user?: unknown;
      csrfToken?: string;
    };
  }>("/refresh");

  const token =
    response.data?.data?.accessToken ?? response.data?.accessToken;

  if (typeof token !== "string" || !token) {
    clearAccessToken();
    throw new Error("Authentication refresh did not return a valid access token.");
  }

  setAccessToken(token);
  return token;
}

export const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return "";

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name}=([^;]*)`)
  );

  return match ? decodeURIComponent(match[1]) : "";
};

const attachAuthInterceptors = (instance: AxiosInstance) => {
  instance.interceptors.request.use((config) => {
    const currentToken = getAccessToken();
    if (currentToken) {
      if (config.headers && typeof config.headers.set === "function") {
        config.headers.set("Authorization", `Bearer ${currentToken}`);
      } else {
        config.headers = {
          ...config.headers,
          Authorization: `Bearer ${currentToken}`,
        } as unknown as typeof config.headers;
      }
    }

    const csrfToken = getCookieValue("csrfToken");

    if (
      csrfToken &&
      config.method &&
      ["post", "put", "patch", "delete"].includes(
        config.method.toLowerCase()
      )
    ) {
      if (config.headers && typeof config.headers.set === "function") {
        config.headers.set("x-csrf-token", csrfToken);
      } else {
        config.headers = {
          ...config.headers,
          "x-csrf-token": csrfToken,
        } as unknown as typeof config.headers;
      }
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => response,

    async (error: AxiosError) => {
      const originalRequest = error.config as RetryableRequestConfig;
      if (!originalRequest) {
        return Promise.reject(error);
      }

      const url = originalRequest.url || "";
      const isAuthEndpoint =
        url.includes("/login") ||
        url.includes("/register") ||
        url.includes("/google") ||
        url.includes("/verify") ||
        url.includes("/verify-otp") ||
        url.includes("/refresh") ||
        url.includes("/logout") ||
        url.includes("/forgot-password") ||
        url.includes("/reset-password");

      const shouldSkipRefresh = originalRequest.skipRefresh || isAuthEndpoint;

      // Don't try to refresh for auth endpoints, logout or refresh requests themselves.
      if (shouldSkipRefresh) {
        if (url.includes("/logout") || url.includes("/refresh")) {
          clearAccessToken();
        }
        return Promise.reject(error);
      }

      // ONLY 401 is an authentication/token expiry issue.
      // 403 Forbidden is an authorization/role issue and must NOT trigger a token refresh loop!
      if (error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              if (typeof token === "string" && originalRequest.headers) {
                if (typeof originalRequest.headers.set === "function") {
                  originalRequest.headers.set("Authorization", `Bearer ${token}`);
                } else {
                  (originalRequest.headers as Record<string, string>).Authorization =
                    `Bearer ${token}`;
                }
              }
              return instance(originalRequest);
            })
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          const validToken = await refreshAccessToken();

          if (originalRequest.headers) {
            if (typeof originalRequest.headers.set === "function") {
              originalRequest.headers.set("Authorization", `Bearer ${validToken}`);
            } else {
              (originalRequest.headers as Record<string, string>).Authorization =
                `Bearer ${validToken}`;
            }
          }

          processQueue(null, validToken);

          return instance(originalRequest);
        } catch (err) {
          processQueue(err, null);
          clearAccessToken();
          return Promise.reject(err);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    }
  );
};

attachAuthInterceptors(api);
attachAuthInterceptors(appApi);

export { refreshClient };
export default api;
