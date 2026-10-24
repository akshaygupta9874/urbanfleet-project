import api from "../apiInterceptor";

export interface DeviceSession {
  id: string;
  browser: string;
  os: string;
  deviceType: "Desktop" | "Mobile" | "Tablet" | "Unknown";
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface ListSessionsResponse {
  currentSessionId: string | null;
  sessions: DeviceSession[];
}

export const sessionApi = {
  /**
   * Fetches all active sessions for the current authenticated user.
   */
  listSessions: async (): Promise<ListSessionsResponse> => {
    const res = await api.get<{ success: boolean; data: ListSessionsResponse }>("/sessions");
    return res.data.data;
  },

  /**
   * Revokes a specific session by its sessionId.
   */
  revokeSession: async (sessionId: string): Promise<void> => {
    await api.delete(`/sessions/${sessionId}`);
  },

  /**
   * Revokes all active sessions for this user EXCEPT the current session.
   */
  logoutAllOtherSessions: async (): Promise<void> => {
    await api.post("/sessions/logout-all");
  },
};
