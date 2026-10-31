import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  User,
  Car,
  Camera,
  FileText,
  ClipboardCheck,
  IdCard,
  FileCheck2,
  ShieldCheck,
  Leaf,
  Upload,
  Pencil,
  Building2,
  CreditCard,
  Sparkles,
  Clock,
  Home,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import LoadingScreen from "./components/LoadingScreen";
import { useAuthContext } from "./context/auth-context";
import { registerDriver, fetchDriverProfile, isDriverApproved, type DriverProfile } from "./lib/driverApi";
import { isAxiosError } from "axios";

const DISPLAY_FONT = "'Fraunces', Georgia, serif";
const BODY_FONT = "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif";

type FormState = {
  profilePhoto: File | null;
  vehicleFront: File | null;
  vehicleBack: File | null;
  vehicleLeft: File | null;
  vehicleRight: File | null;
  vehicleInterior: File | null;
  vehicleType: "CAR" | "BIKE" | "AUTO";
  vehicleBrand: string;
  vehicleModel: string;
  vehicleColor: string;
  registrationNumber: string;
  registrationYear: number;
  licenseNumber: string;
  licenseExpiry: string;
  licenseFront: File | null;
  licenseBack: File | null;
  registrationCertificateNumber: string;
  registrationCertificateImage: File | null;
  insuranceNumber: string;
  insuranceExpiry: string;
  insuranceImage: File | null;
  pollutionExpiry: string;
  pollutionImage: File | null;
  aadharNumber: string;
  aadharFront: File | null;
  aadharBack: File | null;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  upiId: string;
  passbookPhoto: File | null;
};

const STEPS: { key: string; title: string; icon: LucideIcon }[] = [
  { key: "profile", title: "Profile", icon: User },
  { key: "vehicle", title: "Vehicle", icon: Car },
  { key: "photos", title: "Vehicle photos", icon: Camera },
  { key: "documents", title: "Documents & KYC", icon: FileText },
  { key: "banking", title: "Banking & Payouts", icon: Building2 },
  { key: "review", title: "Review", icon: ClipboardCheck },
];


function createMockJpegFile(filename: string, title: string = "UrbanFleet Verification Document"): File {
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Gradient background
        const grad = ctx.createLinearGradient(0, 0, 400, 300);
        grad.addColorStop(0, "#2e1808");
        grad.addColorStop(1, "#7a4416");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 400, 300);

        // Frame border
        ctx.strokeStyle = "#b8722c";
        ctx.lineWidth = 4;
        ctx.strokeRect(12, 12, 376, 276);

        // Header
        ctx.fillStyle = "#f5e6c8";
        ctx.font = "bold 18px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("UrbanFleet Logistics", 200, 75);

        // Badge pill
        ctx.fillStyle = "#b8722c";
        ctx.fillRect(80, 100, 240, 30);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("VERIFIED OFFICIAL ASSET", 200, 120);

        // Document title
        ctx.fillStyle = "#fffaf0";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(title, 200, 175);

        // Subtitle
        ctx.fillStyle = "#d1b392";
        ctx.font = "12px sans-serif";
        ctx.fillText("Default Verification Asset (JPEG)", 200, 215);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
        const byteString = atob(dataUrl.split(",")[1]);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        return new File([ab], filename, { type: "image/jpeg" });
      }
    } catch {
      // Fallback if canvas is unavailable
    }
  }

  const fallbackBytes = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9,
  ]);
  return new File([fallbackBytes], filename, { type: "image/jpeg" });
}

const createDefaultFormState = (userName?: string): FormState => ({
  profilePhoto: createMockJpegFile("profile_photo.jpeg", "Driver Profile Portrait"),
  vehicleFront: createMockJpegFile("vehicle_front.jpeg", "Vehicle Front View"),
  vehicleBack: createMockJpegFile("vehicle_back.jpeg", "Vehicle Back View"),
  vehicleLeft: createMockJpegFile("vehicle_left.jpeg", "Vehicle Left View"),
  vehicleRight: createMockJpegFile("vehicle_right.jpeg", "Vehicle Right View"),
  vehicleInterior: createMockJpegFile("vehicle_interior.jpeg", "Vehicle Interior View"),
  vehicleType: "CAR",
  vehicleBrand: "Toyota",
  vehicleModel: "Innova Crysta",
  vehicleColor: "Pearl White",
  registrationNumber: "MH02UF2026",
  registrationYear: 2023,
  licenseNumber: "DL-0420220012345",
  licenseExpiry: "2032-12-31",
  licenseFront: createMockJpegFile("license_front.jpeg", "Driving License Front"),
  licenseBack: createMockJpegFile("license_back.jpeg", "Driving License Back"),
  registrationCertificateNumber: "RC-MH02-2023-9988",
  registrationCertificateImage: createMockJpegFile("rc_certificate.jpeg", "Registration Certificate (RC)"),
  insuranceNumber: "POL-BAJAJ-77889900",
  insuranceExpiry: "2028-06-30",
  insuranceImage: createMockJpegFile("insurance_policy.jpeg", "Commercial Vehicle Insurance"),
  pollutionExpiry: "2027-12-31",
  pollutionImage: createMockJpegFile("puc_certificate.jpeg", "Pollution Certificate (PUC)"),
  aadharNumber: "556677889900",
  aadharFront: createMockJpegFile("aadhar_front.jpeg", "Aadhaar Card Front"),
  aadharBack: createMockJpegFile("aadhar_back.jpeg", "Aadhaar Card Back"),
  accountHolderName: userName || "Alex Driver",
  accountNumber: "987654321098",
  ifscCode: "HDFC0001234",
  bankName: "HDFC Bank",
  upiId: "alexdriver@okhdfcbank",
  passbookPhoto: createMockJpegFile("passbook_photo.jpeg", "Bank Passbook / Cheque"),
});

export default function DriverRegistration() {
  const { user, isAuthenticated, loading } = useAuthContext();
  const navigate = useNavigate();

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [existingProfile, setExistingProfile] = useState<DriverProfile | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(STEPS.length - 1);
  const [referenceCode] = useState(() => `NV-${Date.now().toString().slice(-6)}`);

  const [form, setForm] = useState<FormState>(() => createDefaultFormState());

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    if (user && (!form.accountHolderName || form.accountHolderName === "Alex Driver")) {
      const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
      if (name) {
        setForm((prev) => ({ ...prev, accountHolderName: name }));
      }
    }
  }, [user, form.accountHolderName]);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated) {
      fetchDriverProfile()
        .then((profile) => {
          if (cancelled) return;
          if (profile) {
            setExistingProfile(profile);
            if (isDriverApproved(profile)) {
              navigate("/driver-dashboard", { replace: true });
            } else {
              setIsSubmitted(true);
            }
          }
        })
        .catch(() => {
          // No profile yet, proceed with application
        });
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, navigate]);

  const handleCheckStatus = async () => {
    setIsCheckingStatus(true);
    setError("");
    try {
      const profile = await fetchDriverProfile();
      if (profile) {
        setExistingProfile(profile);
        if (isDriverApproved(profile)) {
          sessionStorage.setItem("isDriverVerified", "true");
          navigate("/driver-dashboard", { replace: true });
          return;
        }
      }
      setStatus("Status checked: Your application is currently under review by our onboarding desk.");
    } catch {
      setStatus("Your application is currently being processed.");
    } finally {
      setIsCheckingStatus(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Getting things ready" sublabel="Verifying your session" />;
  }

  const isStepComplete = (step: number): boolean => {
    switch (step) {
      case 0:
        return !!form.profilePhoto;
      case 1:
        return !!(
          form.vehicleType &&
          form.vehicleBrand.trim() &&
          form.vehicleModel.trim() &&
          form.vehicleColor.trim() &&
          form.registrationNumber.trim() &&
          form.registrationYear > 0
        );
      case 2:
        return !!(
          form.vehicleFront &&
          form.vehicleBack &&
          form.vehicleLeft &&
          form.vehicleRight &&
          form.vehicleInterior
        );
      case 3:
        return !!(
          form.licenseNumber.trim() &&
          form.licenseExpiry &&
          form.licenseFront &&
          form.licenseBack &&
          form.registrationCertificateNumber.trim() &&
          form.registrationCertificateImage &&
          form.insuranceNumber.trim() &&
          form.insuranceExpiry &&
          form.insuranceImage &&
          form.pollutionExpiry &&
          form.pollutionImage &&
          form.aadharNumber.trim() &&
          form.aadharFront &&
          form.aadharBack
        );
      case 4:
        return !!(
          form.accountHolderName.trim() &&
          form.accountNumber.trim() &&
          form.ifscCode.trim() &&
          form.upiId.trim() &&
          form.passbookPhoto
        );
      case 5:
        return true;
      default:
        return false;
    }
  };

  const goToStep = (index: number) => {
    if (index <= furthestStep) setCurrentStep(index);
  };

  const handleBack = () => setCurrentStep((s) => Math.max(0, s - 1));

  const handleNext = () => {
    if (!isStepComplete(currentStep)) return;
    const next = Math.min(STEPS.length - 1, currentStep + 1);
    setCurrentStep(next);
    setFurthestStep((f) => Math.max(f, next));
  };

  const submitApplication = async () => {
    setError("");
    setStatus("");

    if (!user?.id) {
      setError("Unable to determine your account. Please log in again.");
      return;
    }

    const formData = new FormData();

    formData.append("userId", user.id);

    formData.append(
      "vehicle",
      JSON.stringify({
        type: form.vehicleType,
        brand: form.vehicleBrand,
        model: form.vehicleModel,
        color: form.vehicleColor,
        registrationNumber: form.registrationNumber,
        registrationYear: form.registrationYear,
      })
    );

    formData.append(
      "banking",
      JSON.stringify({
        accountHolderName: form.accountHolderName,
        accountNumber: form.accountNumber,
        ifscCode: form.ifscCode,
        bankName: form.bankName,
        upiId: form.upiId,
      })
    );

    formData.append(
      "documents",
      JSON.stringify({
        drivingLicense: {
          number: form.licenseNumber,
          expiryDate: form.licenseExpiry,
        },
        registrationCertificate: {
          number: form.registrationCertificateNumber,
        },
        insurance: {
          number: form.insuranceNumber,
          expiryDate: form.insuranceExpiry,
        },
        pollutionCertificate: {
          expiryDate: form.pollutionExpiry,
        },
        aadhar: {
          number: form.aadharNumber,
        },
      })
    );

    if (form.profilePhoto) formData.append("profilePhoto", form.profilePhoto);
    if (form.vehicleFront) formData.append("vehicleFront", form.vehicleFront);
    if (form.vehicleBack) formData.append("vehicleBack", form.vehicleBack);
    if (form.vehicleLeft) formData.append("vehicleLeft", form.vehicleLeft);
    if (form.vehicleRight) formData.append("vehicleRight", form.vehicleRight);
    if (form.vehicleInterior) formData.append("vehicleInterior", form.vehicleInterior);
    if (form.licenseFront) formData.append("licenseFront", form.licenseFront);
    if (form.licenseBack) formData.append("licenseBack", form.licenseBack);
    if (form.registrationCertificateImage)
      formData.append("registrationCertificate", form.registrationCertificateImage);
    if (form.insuranceImage) formData.append("insurance", form.insuranceImage);
    if (form.pollutionImage) formData.append("pollutionCertificate", form.pollutionImage);
    if (form.aadharFront) formData.append("aadharFront", form.aadharFront);
    if (form.aadharBack) formData.append("aadharBack", form.aadharBack);
    if (form.passbookPhoto) formData.append("passbookPhoto", form.passbookPhoto);

    setSubmitting(true);

    try {
      await registerDriver(formData);
      sessionStorage.setItem("isDriverVerified", "false");
      setIsSubmitted(true);
      setStatus("Application submitted successfully. Your details and documents are now under review.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: unknown) {
      const message = isAxiosError<{ message?: unknown }>(err)
        ? err.response?.data?.message
        : undefined;
      setError(typeof message === "string" ? message : "Unable to register as driver. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const photosAdded = [
    form.vehicleFront,
    form.vehicleBack,
    form.vehicleLeft,
    form.vehicleRight,
    form.vehicleInterior,
  ].filter(Boolean).length;

  const documentsComplete = [
    Boolean(form.licenseNumber && form.licenseExpiry && form.licenseFront && form.licenseBack),
    Boolean(form.registrationCertificateNumber && form.registrationCertificateImage),
    Boolean(form.insuranceNumber && form.insuranceExpiry && form.insuranceImage),
    Boolean(form.pollutionExpiry && form.pollutionImage),
    Boolean(form.aadharNumber && form.aadharFront && form.aadharBack),
  ].filter(Boolean).length;

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#f5e6c8] text-[#2e1808]" style={{ fontFamily: BODY_FONT }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap');
      `}</style>

      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 h-96 w-96 rounded-full bg-[#f4b860]/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[28rem] w-[28rem] rounded-full bg-[#b8722c]/15 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-[#c58a3a]/15 blur-[100px]" />
      </div>

      <div className="relative w-full px-4 sm:px-8 lg:px-12 py-8 space-y-8 max-w-7xl mx-auto">
        
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-r from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 backdrop-blur-xl shadow-xl px-6 py-5 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] text-[#3a1f0a] transition hover:bg-[#fff4dc] hover:scale-105 shadow-sm"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4 text-[#b8722c]" />
            </button>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7a4416]">
                UrbanFleet · Driver Onboarding
              </p>
              <h1
                className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#2e1808]"
                style={{ fontFamily: DISPLAY_FONT }}
              >
                Apply to drive with us
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isSubmitted && (
              <button
                type="button"
                onClick={() => {
                  setForm(createDefaultFormState(user ? `${user.firstName || ""}`.trim() : undefined));
                  setFurthestStep(STEPS.length - 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-[#b8722c]/40 bg-[#fffaf0] px-3.5 py-2 text-xs font-bold text-[#7a4416] transition hover:bg-[#fff4dc] hover:scale-105 shadow-sm"
                title="Reset and re-populate all fields with demo text and JPEG images"
              >
                <Sparkles className="h-3.5 w-3.5 text-[#b8722c]" />
                <span className="hidden sm:inline">Auto-fill Demo</span>
                <span className="sm:hidden">Auto-fill</span>
              </button>
            )}
            <div className="hidden shrink-0 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0]/90 px-5 py-2.5 text-right sm:block shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7a4416]">Logbook No.</p>
              <p className="text-sm font-extrabold text-[#3a1f0a]">{referenceCode}</p>
            </div>
          </div>
        </motion.header>

        {isSubmitted ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="space-y-8"
          >
            {/* Status Hero Card */}
            <div className="w-full rounded-[2.5rem] border border-[#fff4dc]/80 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-8 sm:p-12 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col items-center text-center max-w-2xl mx-auto space-y-6">
                
                {/* Pulsing Status Icon Badge */}
                <div className="relative">
                  <div className="absolute -inset-2 rounded-full bg-amber-400/25 blur-lg animate-pulse" />
                  <div className="relative grid h-24 w-24 place-items-center rounded-3xl border-2 border-[#b8722c]/40 bg-gradient-to-br from-[#fffaf0] via-[#ffe9be] to-[#f4c875] text-[#3a1f0a] shadow-xl">
                    <Clock className="h-12 w-12 text-[#7a4416] animate-[spin_12s_linear_infinite]" />
                  </div>
                </div>

                <div className="space-y-2.5">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-600/30 bg-amber-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-amber-900 shadow-sm">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                    Application Under Review
                  </div>
                  <h2 className="text-3xl sm:text-4xl font-black text-[#3a1f0a] tracking-tight" style={{ fontFamily: DISPLAY_FONT }}>
                    Dossier Submitted Successfully
                  </h2>
                  <p className="text-base text-[#6b3a12] font-medium leading-relaxed">
                    Thank you, <span className="font-bold text-[#3a1f0a]">{user?.firstName || "Captain"}</span>. Your captain registration dossier has been logged in our fleet dispatch registry under reference <span className="font-mono font-bold text-[#3a1f0a]">{referenceCode}</span>.
                  </p>
                </div>

                {/* Verification Progress Matrix */}
                <div className="w-full grid grid-cols-2 sm:grid-cols-4 gap-3 text-left pt-2">
                  <div className="rounded-2xl border border-emerald-600/25 bg-emerald-500/10 p-3.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold uppercase tracking-wide">
                      <Check className="h-4 w-4 text-emerald-600" /> Identity
                    </div>
                    <p className="mt-1 text-xs text-emerald-950 font-medium truncate">Profile photo logged</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-600/25 bg-emerald-500/10 p-3.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold uppercase tracking-wide">
                      <Check className="h-4 w-4 text-emerald-600" /> Vehicle
                    </div>
                    <p className="mt-1 text-xs text-emerald-950 font-medium truncate">
                      {form.vehicleBrand ? `${form.vehicleBrand} ${form.vehicleModel}` : "Vehicle specs logged"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-amber-600/35 bg-amber-500/15 p-3.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold uppercase tracking-wide">
                      <Clock className="h-4 w-4 text-amber-700 animate-pulse" /> Documents
                    </div>
                    <p className="mt-1 text-xs text-amber-950 font-medium truncate">Under admin review</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-600/25 bg-emerald-500/10 p-3.5 shadow-sm">
                    <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold uppercase tracking-wide">
                      <Check className="h-4 w-4 text-emerald-600" /> Payouts
                    </div>
                    <p className="mt-1 text-xs text-emerald-950 font-medium truncate">{form.bankName || "Banking connected"}</p>
                  </div>
                </div>

                {/* Detailed Application Summary Card */}
                <div className="w-full rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0]/85 p-6 text-left space-y-4 shadow-sm">
                  <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">Registry Logbook ID</span>
                      <p className="font-mono text-base font-extrabold text-[#3a1f0a]">
                        {existingProfile?.id ? `DRV-${existingProfile.id.slice(-6).toUpperCase()}` : referenceCode}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#7a4416]">Verification Status</span>
                      <p className="text-xs font-extrabold text-amber-800 uppercase tracking-wide">
                        {existingProfile?.verificationStatus?.replace("_", " ") || "Pending Review"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs text-[#6b3a12]">
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Captain:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">{user?.firstName} {user?.lastName}</span>
                    </div>
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Contact:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">{user?.email || "—"}</span>
                    </div>
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Vehicle:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">{form.vehicleBrand} {form.vehicleModel} ({form.vehicleType})</span>
                    </div>
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Plate No:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">{form.registrationNumber || "—"}</span>
                    </div>
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Driving License:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">{form.licenseNumber || "—"}</span>
                    </div>
                    <div className="bg-[#fff4dc]/50 p-3 rounded-xl border border-[#7a4416]/10">
                      <span className="font-semibold text-[#7a4416]">Payout Method:</span>{" "}
                      <span className="font-bold text-[#3a1f0a]">
                        {form.bankName ? `${form.bankName} (•••• ${form.accountNumber.slice(-4)})` : form.upiId || "Bank Account"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Helpful Advisory Banner */}
                <div className="w-full rounded-2xl border border-sky-600/25 bg-sky-500/10 p-4 text-left shadow-sm">
                  <p className="text-xs font-semibold text-sky-950 leading-relaxed">
                    🛡️ <span className="font-bold">What happens next?</span> Our verification desk reviews your driving license, vehicle registration, and safety records. Typically approvals take between 12 to 24 hours. You can click <strong>"Check Verification Status"</strong> below at any time. Once approved, you will immediately unlock your Driver Dashboard.
                  </p>
                </div>

                {/* Feedback status if user clicked Check Status */}
                {status && (
                  <div className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 text-xs font-semibold text-emerald-900 shadow-sm">
                    {status}
                  </div>
                )}
                {error && (
                  <div className="w-full rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5 text-xs font-semibold text-rose-900 shadow-sm">
                    {error}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full pt-2">
                  <button
                    type="button"
                    onClick={handleCheckStatus}
                    disabled={isCheckingStatus}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 py-3.5 text-sm font-bold text-[#ffe9be] shadow-lg transition hover:shadow-xl hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isCheckingStatus ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-[#ffd88a]" />
                        Checking Status…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 text-[#ffd88a]" />
                        Check Verification Status
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] px-8 py-3.5 text-sm font-bold text-[#3a1f0a] transition hover:bg-[#fff4dc] hover:scale-[1.02] shadow-sm"
                  >
                    <Home className="h-4 w-4 text-[#b8722c]" />
                    Return to Home
                  </button>
                </div>

              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Progress Tracker */}
            <div className="w-full rounded-[2rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 shadow-xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#7a4416]">
            <span>
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <span className="text-[#3a1f0a]">{STEPS[currentStep].title}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#7a4416]/15">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#b8722c]"
              animate={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Alerts */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full overflow-hidden rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 text-sm font-semibold text-rose-900 shadow-sm"
            >
              {error}
            </motion.div>
          )}
          {status && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full overflow-hidden rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4 text-sm font-semibold text-emerald-900 shadow-sm"
            >
              {status}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wizard Layout */}
        <div className="grid gap-8 lg:grid-cols-[280px_1fr] w-full items-start">
          
          {/* Step Rail Navigation */}
          <div className="h-fit rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-4 shadow-xl lg:sticky lg:top-8 w-full backdrop-blur-2xl">
            <div className="space-y-2">
              {STEPS.map((step, index) => (
                <StepTab
                  key={step.key}
                  title={step.title}
                  Icon={step.icon}
                  active={index === currentStep}
                  complete={index < STEPS.length - 1 ? isStepComplete(index) : false}
                  reachable={index <= furthestStep}
                  onClick={() => goToStep(index)}
                />
              ))}
            </div>
          </div>

          {/* Step Content Card */}
          <div className="rounded-[2.5rem] border border-[#fff4dc]/70 bg-gradient-to-b from-[#fffaf0]/95 via-[#fff4dc]/90 to-[#f7e2b8]/90 p-6 sm:p-10 shadow-2xl w-full backdrop-blur-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                {currentStep === 0 && (
                  <div>
                    <StepHeader
                      icon={User}
                      title="Profile photo"
                      description="Upload a clear profile photo for verification and riders."
                    />
                    <div className="mb-6 flex items-center gap-4">
                      <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-[#b8722c]/40 bg-[#fffaf0] shadow-inner">
                        {form.profilePhoto ? (
                          <img
                            src={URL.createObjectURL(form.profilePhoto)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <User className="h-10 w-10 text-[#7a4416]/50" />
                        )}
                      </div>
                      <p className="text-sm font-medium text-[#6b3a12]">
                        Choose a high-resolution portrait or image file from your device.
                      </p>
                    </div>
                    <FileField
                      label="Upload profile photo"
                      file={form.profilePhoto}
                      onChange={(file) => updateField("profilePhoto", file)}
                      required
                    />
                  </div>
                )}

                {currentStep === 1 && (
                  <div>
                    <StepHeader
                      icon={Car}
                      title="Vehicle details"
                      description="Tell us about the vehicle you'll be driving."
                    />
                    <div className="grid gap-6 sm:grid-cols-2">
                      <SelectField
                        label="Type"
                        value={form.vehicleType}
                        onChange={(v) => updateField("vehicleType", v as FormState["vehicleType"])}
                        options={[
                          { value: "CAR", label: "Comfort Car" },
                          { value: "BIKE", label: "Moto / Bike" },
                          { value: "AUTO", label: "Auto Rickshaw" },
                        ]}
                        required
                      />
                      <Field
                        label="Registration number"
                        value={form.registrationNumber}
                        onChange={(v) => updateField("registrationNumber", v.toUpperCase())}
                        placeholder="e.g., WB 25 AB 1234"
                        required
                      />
                      <Field
                        label="Brand"
                        value={form.vehicleBrand}
                        onChange={(v) => updateField("vehicleBrand", v)}
                        placeholder="e.g. Maruti Suzuki"
                        required
                      />
                      <Field
                        label="Model"
                        value={form.vehicleModel}
                        onChange={(v) => updateField("vehicleModel", v)}
                        placeholder="e.g. Swift Dzire"
                        required
                      />
                      <Field
                        label="Color"
                        value={form.vehicleColor}
                        onChange={(v) => updateField("vehicleColor", v)}
                        placeholder="e.g. Pearl white"
                        required
                      />
                      <Field
                        label="Registration year"
                        type="number"
                        value={String(form.registrationYear)}
                        onChange={(v) => updateField("registrationYear", Number(v))}
                        required
                      />
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div>
                    <StepHeader
                      icon={Camera}
                      title="Vehicle photos"
                      description="Upload clear image files from all four sides plus the interior."
                    />
                    <div className="grid gap-6 sm:grid-cols-2">
                      <FileField
                        label="Front view"
                        file={form.vehicleFront}
                        onChange={(f) => updateField("vehicleFront", f)}
                        required
                      />
                      <FileField
                        label="Back view"
                        file={form.vehicleBack}
                        onChange={(f) => updateField("vehicleBack", f)}
                        required
                      />
                      <FileField
                        label="Left side view"
                        file={form.vehicleLeft}
                        onChange={(f) => updateField("vehicleLeft", f)}
                        required
                      />
                      <FileField
                        label="Right side view"
                        file={form.vehicleRight}
                        onChange={(f) => updateField("vehicleRight", f)}
                        required
                      />
                      <FileField
                        label="Interior view"
                        file={form.vehicleInterior}
                        onChange={(f) => updateField("vehicleInterior", f)}
                        required
                      />
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div>
                    <StepHeader
                      icon={FileText}
                      title="Documents"
                      description="Upload valid official documents and images."
                    />
                    <div className="space-y-6">
                      <DocumentCard
                        icon={IdCard}
                        title="Driving license"
                        complete={Boolean(
                          form.licenseNumber &&
                            form.licenseExpiry &&
                            form.licenseFront &&
                            form.licenseBack
                        )}
                      >
                        <Field
                          label="License number"
                          value={form.licenseNumber}
                          onChange={(v) => updateField("licenseNumber", v)}
                          placeholder="License number"
                          required
                        />
                        <Field
                          label="Expiry date"
                          type="date"
                          value={form.licenseExpiry}
                          onChange={(v) => updateField("licenseExpiry", v)}
                          required
                        />
                        <FileField
                          label="Front image"
                          file={form.licenseFront}
                          onChange={(f) => updateField("licenseFront", f)}
                          required
                        />
                        <FileField
                          label="Back image"
                          file={form.licenseBack}
                          onChange={(f) => updateField("licenseBack", f)}
                          required
                        />
                      </DocumentCard>

                      <DocumentCard
                        icon={FileCheck2}
                        title="Registration certificate (RC)"
                        complete={Boolean(
                          form.registrationCertificateNumber && form.registrationCertificateImage
                        )}
                      >
                        <Field
                          label="Certificate number"
                          value={form.registrationCertificateNumber}
                          onChange={(v) => updateField("registrationCertificateNumber", v)}
                          placeholder="Certificate number"
                          required
                        />
                        <FileField
                          label="Certificate image"
                          file={form.registrationCertificateImage}
                          onChange={(f) => updateField("registrationCertificateImage", f)}
                          required
                        />
                      </DocumentCard>

                      <DocumentCard
                        icon={ShieldCheck}
                        title="Insurance"
                        complete={Boolean(
                          form.insuranceNumber && form.insuranceExpiry && form.insuranceImage
                        )}
                      >
                        <Field
                          label="Policy number"
                          value={form.insuranceNumber}
                          onChange={(v) => updateField("insuranceNumber", v)}
                          placeholder="Policy number"
                          required
                        />
                        <Field
                          label="Expiry date"
                          type="date"
                          value={form.insuranceExpiry}
                          onChange={(v) => updateField("insuranceExpiry", v)}
                          required
                        />
                        <FileField
                          label="Policy image"
                          file={form.insuranceImage}
                          onChange={(f) => updateField("insuranceImage", f)}
                          required
                        />
                      </DocumentCard>

                      <DocumentCard
                        icon={Leaf}
                        title="Pollution certificate (PUC)"
                        complete={Boolean(form.pollutionExpiry && form.pollutionImage)}
                      >
                        <Field
                          label="Expiry date"
                          type="date"
                          value={form.pollutionExpiry}
                          onChange={(v) => updateField("pollutionExpiry", v)}
                          required
                        />
                        <FileField
                          label="Certificate image"
                          file={form.pollutionImage}
                          onChange={(f) => updateField("pollutionImage", f)}
                          required
                        />
                      </DocumentCard>

                      <DocumentCard
                        icon={IdCard}
                        title="Aadhaar card (KYC)"
                        complete={Boolean(form.aadharNumber && form.aadharFront && form.aadharBack)}
                      >
                        <Field
                          label="Aadhaar number"
                          value={form.aadharNumber}
                          onChange={(v) => updateField("aadharNumber", v)}
                          placeholder="12-digit Aadhaar number"
                          required
                        />
                        <FileField
                          label="Aadhaar front image"
                          file={form.aadharFront}
                          onChange={(f) => updateField("aadharFront", f)}
                          required
                        />
                        <FileField
                          label="Aadhaar back image"
                          file={form.aadharBack}
                          onChange={(f) => updateField("aadharBack", f)}
                          required
                        />
                      </DocumentCard>
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div>
                    <StepHeader
                      icon={Building2}
                      title="Banking & Payouts"
                      description="Direct deposit details and UPI ID for instant ride earnings disbursement."
                    />
                    <div className="space-y-6">
                      <DocumentCard
                        icon={Building2}
                        title="Bank account details"
                        complete={Boolean(
                          form.accountHolderName &&
                            form.accountNumber &&
                            form.ifscCode &&
                            form.passbookPhoto
                        )}
                      >
                        <Field
                          label="Account holder name"
                          value={form.accountHolderName}
                          onChange={(v) => updateField("accountHolderName", v)}
                          placeholder="Name as per bank records"
                          required
                        />
                        <Field
                          label="Account number"
                          value={form.accountNumber}
                          onChange={(v) => updateField("accountNumber", v)}
                          placeholder="Bank account number"
                          required
                        />
                        <Field
                          label="IFSC code"
                          value={form.ifscCode}
                          onChange={(v) => updateField("ifscCode", v.toUpperCase())}
                          placeholder="e.g. SBIN0001234"
                          required
                        />
                        <Field
                          label="Bank name"
                          value={form.bankName}
                          onChange={(v) => updateField("bankName", v)}
                          placeholder="e.g. State Bank of India, HDFC"
                        />
                        <FileField
                          label="Bank passbook / cancelled cheque photo"
                          file={form.passbookPhoto}
                          onChange={(f) => updateField("passbookPhoto", f)}
                          required
                        />
                      </DocumentCard>

                      <DocumentCard
                        icon={CreditCard}
                        title="Instant UPI transfer"
                        complete={Boolean(form.upiId)}
                      >
                        <Field
                          label="UPI ID / VPA"
                          value={form.upiId}
                          onChange={(v) => updateField("upiId", v)}
                          placeholder="e.g. driver@oksbi, mobile@upi"
                          required
                        />
                      </DocumentCard>
                    </div>
                  </div>
                )}

                {currentStep === 5 && (
                  <div>
                    <StepHeader
                      icon={ClipboardCheck}
                      title="Review & submit"
                      description="Double check everything before sending your application."
                    />
                    <div className="space-y-4">
                      <ReviewRow
                        title="Profile photo"
                        value={form.profilePhoto ? form.profilePhoto.name : "Missing"}
                        onEdit={() => goToStep(0)}
                      />
                      <ReviewRow
                        title="Vehicle"
                        value={`${form.vehicleBrand || "—"} ${form.vehicleModel || ""} · ${
                          form.vehicleColor || "—"
                        } · ${form.registrationNumber || "no reg. number"}`}
                        onEdit={() => goToStep(1)}
                      />
                      <ReviewRow
                        title="Vehicle photos"
                        value={`${photosAdded} of 5 photos added`}
                        onEdit={() => goToStep(2)}
                      />
                      <ReviewRow
                        title="Documents & KYC"
                        value={`${documentsComplete} of 5 documents complete`}
                        onEdit={() => goToStep(3)}
                      />
                      <ReviewRow
                        title="Banking & UPI"
                        value={`${form.bankName ? form.bankName + " " : ""}A/C: •••• ${form.accountNumber.slice(-4) || "—"} · UPI: ${form.upiId || "—"}`}
                        onEdit={() => goToStep(4)}
                      />
                    </div>
                    <p className="mt-6 text-sm font-medium text-[#6b3a12]">
                      Once approved by the admin, you'll be able to access your driver dashboard, receive ride requests,
                      and withdraw earnings instantly to your bank or UPI.
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Step Navigation Footer */}
            <div className="mt-10 flex items-center justify-between border-t border-dashed border-[#7a4416]/25 pt-6">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="inline-flex items-center gap-2 rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] px-6 py-3 text-sm font-bold text-[#3a1f0a] transition hover:bg-[#fff4dc] disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
              >
                <ArrowLeft className="h-4 w-4 text-[#b8722c]" /> Back
              </button>

              {currentStep < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!isStepComplete(currentStep)}
                  className="group relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 py-3.5 text-sm font-bold text-[#ffe9be] shadow-lg transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                  <span className="relative z-10 inline-flex items-center gap-2">
                    Continue <ArrowRight className="h-4 w-4 text-[#ffd88a]" />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submitApplication}
                  disabled={submitting}
                  className="group relative inline-flex items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-8 py-3.5 text-sm font-bold text-[#ffe9be] shadow-lg transition hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-[#c58a3a]/40" />
                  <span className="relative z-10 inline-flex items-center gap-2">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-[#ffd88a]" /> Submitting…
                      </>
                    ) : (
                      <>
                        Submit application <ArrowRight className="h-4 w-4 text-[#ffd88a]" />
                      </>
                    )}
                  </span>
                </button>
              )}
            </div>

          </div>

        </div>
        </>
        )}

      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function StepTab({
  title,
  Icon,
  active,
  complete,
  reachable,
  onClick,
}: {
  title: string;
  Icon: LucideIcon;
  active: boolean;
  complete: boolean;
  reachable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!reachable}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffe9be] shadow-md shadow-[#3a1f0a]/30 ring-1 ring-[#c58a3a]/40"
          : complete
            ? "bg-[#fffaf0] text-[#3a1f0a] hover:bg-[#fff4dc]"
            : "text-[#7a4416] hover:bg-[#fffaf0]/60"
      }`}
    >
      <span
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border ${
          active
            ? "border-[#c58a3a]/50 bg-[#2e1808] text-[#ffd88a]"
            : complete
              ? "border-[#7a4416]/30 bg-[#fffaf0] text-[#3a1f0a]"
              : "border-[#7a4416]/20 bg-[#fffaf0]/50 text-[#7a4416]"
        }`}
      >
        {complete && !active ? (
          <Check className="h-4 w-4 text-[#b8722c]" />
        ) : (
          <Icon className="h-4 w-4" />
        )}
      </span>
      <span className="text-sm font-bold">{title}</span>
    </button>
  );
}

function StepHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] text-[#ffd88a] shadow-md border border-[#c58a3a]/40">
        <Icon className="h-6 w-6 text-[#ffd88a]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-[#2e1808]" style={{ fontFamily: DISPLAY_FONT }}>
          {title}
        </h2>
        <p className="mt-1 text-sm font-medium text-[#6b3a12]">{description}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "date" | "number";
  required?: boolean;
}) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-[#7a4416]">
        {label}
        {required && <span className="text-[#b8722c]"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] px-4 py-3.5 text-sm text-[#2e1808] outline-none transition placeholder:text-[#7a4416]/45 focus:border-[#b8722c] focus:ring-2 focus:ring-[#b8722c]/20 shadow-sm"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-[#7a4416]">
        {label}
        {required && <span className="text-[#b8722c]"> *</span>}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] px-4 py-3.5 text-sm text-[#2e1808] outline-none transition focus:border-[#b8722c] focus:ring-2 focus:ring-[#b8722c]/20 shadow-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileField({
  label,
  file,
  onChange,
  required,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
}) {
  return (
    <label className="block w-full">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-[#7a4416]">
        {label}
        {required && <span className="text-[#b8722c]"> *</span>}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex flex-1 cursor-pointer items-center justify-between rounded-2xl border border-[#7a4416]/25 bg-[#fffaf0] px-4 py-3.5 text-sm text-[#2e1808] transition hover:bg-[#fff4dc] shadow-sm">
          <span className="truncate text-sm font-medium text-[#3a1f0a]">
            {file ? file.name : "Choose file..."}
          </span>
          <Upload className="h-4 w-4 shrink-0 text-[#b8722c]" />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => onChange(e.target.files?.[0] ?? null)}
            required={required && !file}
            className="hidden"
          />
        </label>
      </div>
    </label>
  );
}

function DocumentCard({
  icon: Icon,
  title,
  complete,
  children,
}: {
  icon: LucideIcon;
  title: string;
  complete: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-[#7a4416]/20 bg-[#fffaf0]/80 p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#7a4416]/10 text-[#b8722c] border border-[#7a4416]/20">
            <Icon className="h-5 w-5" />
          </div>
          <p className="text-base font-bold text-[#2e1808]">{title}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border ${
            complete
              ? "bg-emerald-500/15 text-emerald-900 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-900 border-amber-500/30"
          }`}
        >
          {complete ? "Complete" : "Pending"}
        </span>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ReviewRow({ title, value, onEdit }: { title: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[#7a4416]/20 bg-[#fffaf0] px-5 py-4 shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#7a4416]">{title}</p>
        <p className="mt-1 text-sm font-bold text-[#2e1808]">{value}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-xl border border-[#7a4416]/25 bg-[#fffaf0] px-4 py-2 text-xs font-bold text-[#3a1f0a] transition hover:bg-[#fff4dc] shadow-sm"
      >
        <Pencil className="h-3 w-3 text-[#b8722c]" /> Edit
      </button>
    </div>
  );
}