
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import { BrowserRouter, Routes, Route } from "react-router-dom"
import { lazy, Suspense } from 'react'
import LoadingScreen from './components/LoadingScreen.tsx'
export { default as LoadingScreen } from './components/LoadingScreen.tsx'
import { AuthContextProvider } from './context/authContext.tsx'
import { ProtectedRoutes } from './components/ProtectedRoutes.tsx'

const LoginPage = lazy(() => import('./Login.tsx'))
const FinalLandingPage = lazy(() => import('./FinalLandingPage.tsx'))
const SignupPage = lazy(() => import('./Signup.tsx'))
const VerifyEmail = lazy(() => import('./VerifyEmail.tsx'))
const Dashboard = lazy(() => import('./Dashboard.tsx'))
const ForgotPasswordPage = lazy(() => import('./ForgotPassword.tsx'))
const ResetPasswordPage = lazy(() => import('./ResetPassword.tsx'))
const RideHistory = lazy(() => import('./RideHistory.tsx'))
const DriverRegistration = lazy(() => import('./DriverRegistration.tsx'))
const DriverDashboard = lazy(() => import('./DriverDashboard.tsx'))
const RideDetails = lazy(() => import('./RideDetails.tsx'))
const ChooseMode = lazy(() => import('./ChooseMode.tsx'))

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

createRoot(document.getElementById('root')!).render(
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

  {/* Rider */}
  <Route element={<ProtectedRoutes allowedroles={["RIDER"]} />}>
    <Route path="/choose" element={<ChooseMode />} />
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/history" element={<RideHistory />} />
    <Route path="/ride/:rideId" element={<RideDetails />} />
    <Route path="/driver-registration" element={<DriverRegistration />} />
  </Route>

  {/* Driver */}
  <Route element={<ProtectedRoutes allowedroles={["DRIVER"]} />}>
    <Route path="/driver-dashboard" element={<DriverDashboard />} />
  </Route>
</Routes>
     </Suspense>
    </AuthContextProvider>
  </BrowserRouter>
  </GoogleOAuthProvider>
)
