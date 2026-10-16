import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "./apiInterceptor";
import { AxiosError } from "axios";
import { useAuthContext } from "./context/auth-context";

export default function VerifyEmail() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { checkAuthentication } = useAuthContext();
  const [status, setStatus] = useState("Verifying your account...");

  useEffect(() => {
    async function verifyAccount() {
      if (!token) {
        setStatus("Verification token is missing.");
        return;
      }

      try {
        const { data } = await api.post<{ message: string }>(`/verify/${token}`);
        setStatus(data.message);
        await checkAuthentication();
        navigate("/dashboard", { replace: true });
      } catch (error) {
        setStatus(error instanceof AxiosError ? error.response?.data.message : "Verification failed");
      }
    }

    void verifyAccount();
  }, [token, checkAuthentication, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f0ece2] px-6 text-black">
      <section className="w-full max-w-md rounded-2xl bg-white/85 p-8 text-center shadow-xl">
        <h1 className="text-3xl font-bold tracking-tight">Account verification</h1>
        <p className="mt-4 text-sm font-medium text-black/65">{status}</p>
        <button
          type="button"
          onClick={() => navigate("/dashboard")}
          className="mt-8 w-full rounded-xl bg-black py-3.5 text-base font-medium text-white transition-all hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
        >
          Go to dashboard
        </button>
      </section>
    </main>
  );
}
