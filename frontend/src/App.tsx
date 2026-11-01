import { GoogleOAuthProvider } from '@react-oauth/google'
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { lazy, Suspense } from 'react'
import LoadingScreen from './components/LoadingScreen.tsx'
import { AuthContextProvider } from './context/authContext.tsx'
import { ProtectedRoutes } from './components/ProtectedRoutes.tsx'
import UnauthorizedPage from './components/UnauthorizedPage.tsx'

const LoginPage = lazy(() => import('./Login.tsx'))
const FinalLandingPage = lazy(() => import('./FinalLandingPage.tsx'))
const SignupPage = lazy(() => import('./Signup.tsx'))
const VerifyEmail = lazy(() => import('./VerifyEmail.tsx'))
const Dashboard = lazy(() => import('./Dashboard.tsx'))
const ForgotPasswordPage = lazy(() => import('./ForgotPassword.tsx'))
const ResetPasswordPage = lazy(() => import('./ResetPassword.tsx'))
const DriverRegistration = lazy(() => import('./DriverRegistration.tsx'))
const DriverDashboard = lazy(() => import('./DriverDashboard.tsx'))
const RideDetails = lazy(() => import('./RideDetails.tsx'))
const ChooseMode = lazy(() => import('./ChooseMode.tsx'))
const ActiveSessions = lazy(() => import('./ActiveSessions.tsx'))
const AdminDashboard = lazy(() => import('./AdminDashboard.tsx'))

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export default function App() {
  return (
    <GoogleOAuthProvider clientId={googleClientId ?? ""}>
      <BrowserRouter>
        <AuthContextProvider>
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              <Route path="/" element={<FinalLandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token?" element={<ResetPasswordPage />} />
              <Route path="/token/:token" element={<VerifyEmail />} />

              {/* Rider routes - strictly accessible to users with RIDER role */}
              <Route element={<ProtectedRoutes allowedRoles={["RIDER"]} />}>
                <Route path="/choose" element={<ChooseMode />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/ride/:rideId" element={<RideDetails />} />
              </Route>

              {/* Driver registration / application */}
              <Route element={<ProtectedRoutes allowedRoles={["RIDER", "DRIVER"]} />}>
                <Route path="/driver-registration" element={<DriverRegistration />} />
              </Route>

              {/* Active Sessions & Security - accessible to all authenticated users */}
              <Route element={<ProtectedRoutes allowedRoles={["RIDER", "DRIVER", "ADMIN"]} />}>
                <Route path="/security-devices" element={<ActiveSessions />} />
              </Route>

              <Route element={<ProtectedRoutes allowedRoles={["ADMIN"]} />}>
                <Route path="/admin" element={<AdminDashboard />} />
              </Route>

              {/* Driver Dashboard - strictly accessible to users with DRIVER role */}
              <Route element={<ProtectedRoutes allowedRoles={["DRIVER"]} />}>
                <Route path="/driver-dashboard" element={<DriverDashboard />} />
              </Route>

              {/* Explicit Unauthorized Page route */}
              <Route path="/unauthorized" element={<UnauthorizedPage />} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthContextProvider>
      </BrowserRouter>
    </GoogleOAuthProvider>
  );
}
