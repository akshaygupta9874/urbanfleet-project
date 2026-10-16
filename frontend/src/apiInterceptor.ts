import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
} from "axios";

const apiBaseUrl = (
  import.meta.env.VITE_API_URL || "http://localhost:3001"
).replace(/\/+$/u, "");

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

// IMPORTANT:
// This instance has NO interceptors.
// It is only used to refresh tokens.
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
// Access Token
// ============================================================================

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const clearAccessToken = () => {
  accessToken = null;
};

export const getAccessToken = () => accessToken;

export const getCookieValue = (name: string) => {
  if (typeof document === "undefined") return "";

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${name}=([^;]*)`)
  );

  return match ? decodeURIComponent(match[1]) : "";
};


const attachAuthInterceptors = (instance: AxiosInstance) => {
  instance.interceptors.request.use((config) => {
    config.headers = config.headers || {};

    if (accessToken) {
      (config.headers as Record<string, string>).Authorization =
        `Bearer ${accessToken}`;
    }

    const csrfToken = getCookieValue("csrfToken");

    if (
      csrfToken &&
      config.method &&
      ["post", "put", "patch", "delete"].includes(
        config.method.toLowerCase()
      )
    ) {
      (config.headers as Record<string, string>)["x-csrf-token"] =
        csrfToken;
    }

    return config;
  });

  instance.interceptors.response.use(
    (response) => response,

    async (error: AxiosError) => {
      const originalRequest = error.config as RetryableRequestConfig;

      const shouldSkipRefresh =
        originalRequest.skipRefresh ||
        originalRequest.url?.includes("/refresh") ||
        originalRequest.url?.includes("/logout");

      // Don't try to refresh for logout or refresh requests themselves.
      if (shouldSkipRefresh) {
        clearAccessToken();
        return Promise.reject(error);
      }

      if (
        (error.response?.status === 401 ||
          error.response?.status === 403) &&
        !originalRequest._retry
      ) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              if (typeof token === "string" && originalRequest.headers) {
                (originalRequest.headers as Record<string, string>).Authorization =
                  `Bearer ${token}`;
              }
              return instance(originalRequest);
            })
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          // Uses refreshClient (NO INTERCEPTOR)
          const response = await refreshClient.post("/refresh");

          const newAccessToken =
            response.data?.accessToken;

          const validToken =
            typeof newAccessToken === "string" ? newAccessToken : null;

          setAccessToken(validToken);

          if (validToken && originalRequest.headers) {
            (originalRequest.headers as Record<string, string>).Authorization =
              `Bearer ${validToken}`;
          }

          processQueue(null, validToken);

          return instance(originalRequest);
        } catch (err) {
          processQueue(err);

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


export default api;