import { createContext, useContext } from "react";
import type { User, AuthContextType } from "./authContext";

export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuthContext(): AuthContextType {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthContext must be used within an AuthContextProvider");
  }

  return context;
}

export type { AuthContextType, User };
