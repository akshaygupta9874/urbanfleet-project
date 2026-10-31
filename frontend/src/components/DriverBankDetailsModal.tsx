import { useEffect, useState } from "react";
import {
  X,
  Building2,
  CreditCard,
  Upload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  FileCheck2,
} from "lucide-react";
import { updateDriverBankDetails, type DriverBankDetails } from "../lib/driverApi";

interface DriverBankDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: (updated: DriverBankDetails) => void;
  initialData?: {
    accountHolderName?: string;
    accountNumber?: string;
    ifscCode?: string;
    bankName?: string;
    upiId?: string;
    passbookPhoto?: { url: string; publicId: string } | null;
  };
}

const DISPLAY_FONT = "'Fraunces', Georgia, serif";

export default function DriverBankDetailsModal({
  isOpen,
  onClose,
  onUpdated,
  initialData,
}: DriverBankDetailsModalProps) {
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [passbookPhoto, setPassbookPhoto] = useState<File | null>(null);
  const [passbookPreview, setPassbookPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      if (initialData) {
        setAccountHolderName(initialData.accountHolderName || "");
        setAccountNumber(initialData.accountNumber || "");
        setIfscCode(initialData.ifscCode || "");
        setBankName(initialData.bankName || "");
        setUpiId(initialData.upiId || "");
        setPassbookPreview(initialData.passbookPhoto?.url || null);
      }
      setError("");
      setSuccessMsg("");
    });
  }, [initialData, isOpen]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPassbookPhoto(file);
      setPassbookPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountHolderName.trim()) {
      setError("Account holder name is required.");
      return;
    }
    if (!accountNumber.trim()) {
      setError("Account number is required.");
      return;
    }
    if (!ifscCode.trim()) {
      setError("IFSC code is required.");
      return;
    }
    if (!upiId.trim()) {
      setError("UPI ID / VPA is required.");
      return;
    }

    setLoading(true);
    setError("");
    setSuccessMsg("");

    try {
      const updated = await updateDriverBankDetails({
        accountHolderName: accountHolderName.trim(),
        accountNumber: accountNumber.trim(),
        ifscCode: ifscCode.trim().toUpperCase(),
        bankName: bankName.trim(),
        upiId: upiId.trim(),
        passbookPhoto,
      });

      setSuccessMsg("Banking credentials and passbook photo successfully updated!");
      onUpdated?.(updated);
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || "Failed to update bank details. Please check your inputs.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-[#c58a3a]/40 bg-[#fbf6ed] shadow-2xl"
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-[#7a4416]/20 bg-gradient-to-r from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-4 text-[#ffd88a]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#c58a3a]/40 bg-[#2e1808] shadow-inner">
              <Building2 className="h-5 w-5 text-[#ffd88a]" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white" style={{ fontFamily: DISPLAY_FONT }}>
                Bank Account & UPI Details
              </h2>
              <p className="text-xs text-[#ffd88a]/80">Manage your payout destination & verification documents</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#c58a3a]/40 bg-[#3a1f0a] text-[#ffd88a] transition hover:bg-rose-900/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Form */}
        <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/15 p-3.5 text-xs font-semibold text-rose-900 shadow-sm">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-700" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/15 p-3.5 text-xs font-semibold text-emerald-900 shadow-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Bank Account Section */}
          <div className="rounded-2xl border border-[#c58a3a]/30 bg-[#fffaf0]/80 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold text-[#2e1808]">
                <Building2 className="h-4 w-4 text-[#b8722c]" />
                Bank Account (IMPS / NEFT Settlement)
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                RBI Compliant
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1">
                  Account Holder Name
                </label>
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  placeholder="As per bank passbook"
                  className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1">
                  Bank Name (Optional)
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. State Bank of India, HDFC"
                  className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1">
                  Bank Account Number
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Bank account number"
                  className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#7a4416] mb-1">
                  IFSC Code
                </label>
                <input
                  type="text"
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SBIN0001234"
                  className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                  required
                />
              </div>
            </div>

            {/* Passbook / Cheque Upload */}
            <div className="pt-2">
              <label className="block text-xs font-semibold text-[#7a4416] mb-1.5">
                Bank Passbook / Cancelled Cheque Photo
              </label>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {passbookPreview && (
                  <div className="relative h-24 w-36 shrink-0 overflow-hidden rounded-xl border border-[#c58a3a]/40 bg-[#2e1808]/5 shadow-inner">
                    <img
                      src={passbookPreview}
                      alt="Passbook Preview"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute bottom-1 right-1 rounded-sm bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      Current
                    </span>
                  </div>
                )}
                <label className="flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#7a4416]/25 bg-white/60 p-4 text-center transition hover:border-[#b8722c] hover:bg-white">
                  <Upload className="h-5 w-5 text-[#b8722c] mb-1" />
                  <span className="text-xs font-bold text-[#2e1808]">
                    {passbookPhoto ? passbookPhoto.name : "Upload new passbook / cheque image"}
                  </span>
                  <span className="text-[10px] text-[#7a4416]/75">JPG, PNG or PDF up to 5MB</span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* UPI Section */}
          <div className="rounded-2xl border border-[#c58a3a]/30 bg-[#fffaf0]/80 p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-[#7a4416]/15 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold text-[#2e1808]">
                <CreditCard className="h-4 w-4 text-[#b8722c]" />
                UPI ID / VPA (Instant Settlement)
              </span>
              <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Real-Time
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#7a4416] mb-1">
                Virtual Payment Address (UPI VPA)
              </label>
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. driver@oksbi or 9876543210@upi"
                className="w-full rounded-xl border border-[#7a4416]/20 bg-white/90 px-3.5 py-2 text-xs font-medium text-[#2e1808] outline-none focus:border-[#b8722c]"
                required
              />
              <p className="mt-1 text-[11px] text-[#7a4416]/75">
                Instant payouts under ₹1,00,000 are disbursed immediately to this VPA.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-xl border border-[#7a4416]/20 bg-[#fffaf0] px-4 py-2.5 text-xs font-bold text-[#6b3a12] transition hover:bg-[#fff4dc]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#3a1f0a] via-[#6b3a12] to-[#2e1808] px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-[#ffe9be] shadow-md transition hover:opacity-95 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <FileCheck2 className="h-4 w-4" />
                  <span>Save Bank Details</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
