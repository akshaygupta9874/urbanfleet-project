import {
  Car,
  Clock3,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "./ui/button";

export type VerificationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

interface Driver {
  verificationStatus: VerificationStatus;
  isVerified: boolean;
}

interface DriverCTAProps {
  driver: Driver | null;
  loading: boolean;
}

export default function DriverCTA({
  driver,
  loading = false,
}: DriverCTAProps) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <section
        className="
          relative isolate overflow-hidden w-full
          rounded-[2.5rem]
          border border-[#fff4dc]/70
          bg-gradient-to-b
          from-[#fffaf0]/95
          via-[#fff4dc]/90
          to-[#f7e2b8]/90
          backdrop-blur-xl
          p-6 sm:p-8
          shadow-xl
        "
      >
        <BackgroundDecor />

        <div className="relative z-10">
          <p className="text-sm font-semibold text-[#7a4416]">
            Loading driver information...
          </p>
        </div>
      </section>
    );
  }

  if (!driver) {
    return (
      <CardWrapper
        icon={<Car className="h-7 w-7 text-[#b8722c]" />}
        title="Complete Driver Registration"
        description="Finish your registration to continue."
      >
        <CTAButton
          onClick={() => navigate("/driver-registration")}
        >
          Complete Registration
        </CTAButton>
      </CardWrapper>
    );
  }

  switch (driver.verificationStatus) {
    case "PENDING":
      return (
        <CardWrapper
          icon={
            <Clock3 className="h-7 w-7 text-amber-700" />
          }
          title="Application Under Review"
          description="Our team is reviewing your submitted documents."
        >
          <CTAButton disabled>
            Pending Review
          </CTAButton>
        </CardWrapper>
      );

    case "REJECTED":
      return (
        <CardWrapper
          icon={
            <XCircle className="h-7 w-7 text-rose-700" />
          }
          title="Application Rejected"
          description="Please update your documents and submit your application again."
        >
          <CTAButton
            onClick={() => navigate("/driver-registration")}
          >
            Resubmit Application
          </CTAButton>
        </CardWrapper>
      );

    case "APPROVED":
      return (
        <CardWrapper
          icon={
            <CheckCircle2 className="h-7 w-7 text-emerald-700" />
          }
          title="You're Approved!"
          description="Go online and start accepting ride requests."
        >
          <CTAButton
            onClick={() => navigate("/driver-dashboard")}
          >
            Enter Driver Dashboard
          </CTAButton>
        </CardWrapper>
      );

    default:
      return null;
  }
}

interface CardWrapperProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function CardWrapper({
  icon,
  title,
  description,
  children,
}: CardWrapperProps) {
  return (
    <section
      className="
        relative isolate overflow-hidden w-full
        rounded-[2.5rem]
        border border-[#fff4dc]/70
        bg-gradient-to-b
        from-[#fffaf0]/95
        via-[#fff4dc]/90
        to-[#f7e2b8]/90
        backdrop-blur-xl
        p-6 sm:p-8
        shadow-xl
      "
    >
      <BackgroundDecor />

      <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between w-full">
        <div className="flex flex-1 items-center gap-4 sm:gap-5 min-w-0">
          <div
            className="
              grid h-14 w-14 sm:h-16 sm:w-16 shrink-0 place-items-center
              rounded-2xl
              border border-[#7a4416]/25
              bg-[#fffaf0]
              shadow-sm
            "
          >
            {icon}
          </div>

          <div className="min-w-0 flex-1">
            <h3
              className="
                text-xl sm:text-2xl
                font-bold
                tracking-tight
                text-[#2e1808]
              "
              style={{ fontFamily: "'Fraunces', Georgia, serif" }}
            >
              {title}
            </h3>

            <p
              className="
                mt-1
                max-w-xl
                text-xs sm:text-sm
                font-medium
                text-[#6b3a12]
              "
            >
              {description}
            </p>
          </div>
        </div>

        <div className="shrink-0 w-full md:w-auto">
          {children}
        </div>
      </div>
    </section>
  );
}

function CTAButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onClick}
      className="
        group relative
        h-12 sm:h-14
        w-full md:w-auto
        min-w-[220px] sm:min-w-[240px]
        overflow-hidden
        rounded-xl
        bg-gradient-to-br
        from-[#3a1f0a]
        via-[#6b3a12]
        to-[#2e1808]
        px-6 sm:px-8
        text-sm sm:text-base
        font-semibold
        text-[#ffe9be]
        shadow-[0_18px_40px_-12px_rgba(58,31,10,0.7),inset_0_1px_0_rgba(255,216,138,0.35)]
        transition-all
        hover:opacity-95
        active:scale-[0.98]
        disabled:cursor-not-allowed
        disabled:opacity-60
      "
    >
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-[#c58a3a]/40" />

      <span className="relative z-10 inline-flex items-center justify-center gap-2">
        {children}

        {!disabled && (
          <ArrowRight className="h-4 w-4 text-[#ffd88a] transition-transform group-hover:translate-x-1" />
        )}
      </span>
    </Button>
  );
}

function BackgroundDecor() {
  return (
    <>
      {/* Brass top rail */}
      <div className="pointer-events-none absolute inset-x-8 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-[#c58a3a] to-transparent" />
    </>
  );
}