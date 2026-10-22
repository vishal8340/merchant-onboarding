import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const styles = {
  container: {
    height: '100vh',
    background: '#f8fafc',
    padding: '0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  strip: {
    position: 'fixed' as const, left: 0, top: 0, bottom: 0, width: '5px',
    background: 'linear-gradient(180deg, #6366f1 0%, #8b5cf6 50%, #06b6d4 100%)',
    zIndex: 20,
  },
  content: {
    maxWidth: '760px',
    margin: '0 auto',
    flex: 1,
    overflowY: 'auto' as const,
    padding: '20px 20px 16px',
    width: '100%',
  },
  header: {
    textAlign: 'center' as const,
    marginBottom: '16px',
  },
  badge: {
    display: 'inline-block',
    fontSize: '13px', fontWeight: 700,
    color: '#6366f1', background: '#ede9fe',
    borderRadius: '20px', padding: '4px 14px',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    marginBottom: '8px',
  },
  title: {
    fontSize: '26px',
    fontWeight: 800,
    margin: '0 0 6px 0',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748b',
    margin: '0',
  },
  backButton: {
    background: '#fff',
    border: '1.5px solid #e2e8f0',
    color: '#475569',
    padding: '7px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600' as const,
    position: 'absolute' as const,
    right: '20px',
    top: '18px',
    zIndex: 10,
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  card: {
    background: 'linear-gradient(145deg, #ffffff 0%, #f5f3ff 100%)',
    borderRadius: '14px',
    padding: '16px 22px',
    boxShadow: '0 4px 16px rgba(99,102,241,0.1), 0 1px 4px rgba(0,0,0,0.04)',
    border: '1px solid #e0e7ff',
    marginBottom: '10px',
  },
  progressContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'relative' as const,
  },
  progressLine: {
    position: 'absolute' as const,
    top: '16px',
    left: '0',
    right: '0',
    height: '2px',
    background: '#e2e8f0',
    zIndex: 0,
    borderRadius: '4px',
  },
  stepContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    flex: 1,
    position: 'relative' as const,
    zIndex: 1,
  },
  stepCircle: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    fontWeight: 'bold' as const,
    transition: 'all 0.3s',
  },
  stepLabel: {
    marginTop: '6px',
    fontSize: '13px',
    fontWeight: '600' as const,
    letterSpacing: '0.02em',
  },
  sectionHeader: {
    textAlign: 'center' as const,
    marginBottom: '14px',
    paddingBottom: '10px',
    borderBottom: '1px solid #ede9fe',
  },
  sectionIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #ede9fe, #ddd6fe)',
    border: '1.5px solid #c4b5fd',
    fontSize: '24px',
    marginBottom: '8px',
    boxShadow: '0 4px 12px rgba(124,58,237,0.2)',
  },
  sectionTitle: {
    fontSize: '17px',
    fontWeight: 700,
    margin: '0 0 3px 0',
    color: '#0f172a',
  },
  sectionDesc: {
    color: '#64748b',
    margin: '0',
    fontSize: '14px',
  },
  formGroup: {
    marginBottom: '11px',
  },
  label: {
    display: 'block',
    fontWeight: '600' as const,
    marginBottom: '5px',
    color: '#374151',
    fontSize: '13px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    padding: '11px 14px',
    border: '1.5px solid #e2e8f0',
    borderRadius: '9px',
    fontSize: '15px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    color: '#1e293b',
    background: '#fff',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  inputError: {
    borderColor: '#f87171',
    boxShadow: '0 0 0 3px rgba(248,113,113,0.12)',
  },
  errorText: {
    color: '#dc2626',
    fontSize: '13px',
    marginTop: '4px',
    margin: '4px 0 0 0',
  },
  infoBox: {
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '9px',
    padding: '10px 14px',
    marginTop: '8px',
    display: 'flex',
    gap: '10px',
  },
  infoIcon: {
    fontSize: '18px',
  },
  infoTitle: {
    margin: '0 0 4px 0',
    fontWeight: 700,
    color: '#1e40af',
    fontSize: '12px',
  },
  infoText: {
    margin: '0',
    fontSize: '12px',
    color: '#1e3a8a',
  },
  buttonContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '14px',
    paddingTop: '10px',
    borderTop: '1px solid #f1f5f9',
  },
  btnPrimary: {
    padding: '9px 22px',
    background: 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '700' as const,
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
    transition: 'all 0.2s',
    letterSpacing: '0.02em',
  },
  btnSecondary: {
    padding: '9px 22px',
    background: '#fff',
    color: '#475569',
    border: '1.5px solid #e2e8f0',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600' as const,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  stepIndicator: {
    textAlign: 'center' as const,
    marginTop: '12px',
    color: '#cbd5e1',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
  },
};

export const ApplicationForm: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    businessName: '',
    businessType: '',
    country: '',
    city: '',
    taxId: '',
    contactEmail: '',
    contactPhone: '',
    website: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const [pulseSubmit, setPulseSubmit] = useState(false);
  const [duplicateError, setDuplicateError] = useState<{ message: string; fields: string[] } | null>(null);

  // When on step 2 and required fields are filled, scroll to & pulse the submit button
  useEffect(() => {
    if (currentStep === 2 &&
        formData.contactEmail.trim() &&
        /\S+@\S+\.\S+/.test(formData.contactEmail) &&
        formData.contactPhone.trim()) {
      setPulseSubmit(true);
      setTimeout(() => submitBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
      const t = setTimeout(() => setPulseSubmit(false), 3000);
      return () => clearTimeout(t);
    }
  }, [formData.contactEmail, formData.contactPhone, currentStep]);

  const steps = [
    { number: 1, title: 'Business Info', icon: '🏢' },
    { number: 2, title: 'Contact Info', icon: '📧' }
  ];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (errors[e.target.name]) {
      setErrors({ ...errors, [e.target.name]: '' });
    }
    // Clear duplicate error when user edits a conflicting field
    if (duplicateError?.fields.includes(e.target.name)) {
      setDuplicateError(null);
    }
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};
    if (step === 1) {
      if (!formData.businessName.trim()) newErrors.businessName = 'Business name is required';
      if (!formData.businessType) newErrors.businessType = 'Business type is required';
      if (!formData.country) newErrors.country = 'Country is required';
    }
    if (step === 2) {
      if (!formData.contactEmail.trim()) {
        newErrors.contactEmail = 'Email is required';
      } else if (!/\S+@\S+\.\S+/.test(formData.contactEmail)) {
        newErrors.contactEmail = 'Invalid email format';
      }
      if (!formData.contactPhone.trim()) newErrors.contactPhone = 'Phone is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Real-time duplicate check against the DB — called at each step transition
  const runDuplicateCheck = async (fields: { businessName?: string; contactEmail?: string; contactPhone?: string }): Promise<boolean> => {
    try {
      setIsValidating(true);
      const result = await api.validateMerchant(fields);
      if (result.isDuplicate) {
        setDuplicateError({ message: result.message, fields: result.duplicateFields ?? [] });
        return true; // IS a duplicate
      }
      setDuplicateError(null);
      return false;
    } catch {
      // Don't block on network error — backend guards are still in place
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const nextStep = async () => {
    if (!validateStep(currentStep)) return;
    // Check businessName against approved merchants before advancing to step 2
    const isDup = await runDuplicateCheck({ businessName: formData.businessName });
    if (!isDup) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    setCurrentStep(currentStep - 1);
    setDuplicateError(null);
  };

  const handleSubmit = async () => {
    if (!validateStep(2)) return;

    // Final check: validate email + phone (and businessName again) before creating application
    const isDup = await runDuplicateCheck({
      businessName: formData.businessName,
      contactEmail: formData.contactEmail,
      contactPhone: formData.contactPhone,
    });
    if (isDup) return; // error already shown via setDuplicateError

    const autoTaxId = `${String(Math.floor(10 + Math.random() * 90))}-${String(Math.floor(1000000 + Math.random() * 9000000))}`;
    setIsSubmitting(true);
    try {
      const application = await api.createApplication({ ...formData, taxId: autoTaxId });
      navigate(`/application/${application.id}/documents`);
    } catch (error: any) {
      const responseData = error?.response?.data;
      if (error?.response?.status === 409 && responseData?.error === 'MERCHANT_ALREADY_ACTIVE') {
        setDuplicateError({
          message: responseData.message,
          fields: responseData.duplicateFields ?? []
        });
        const hasStep1Conflict = (responseData.duplicateFields ?? []).includes('businessName');
        setCurrentStep(hasStep1Conflict ? 1 : 2);
      } else {
        console.error('Failed to create application:', error);
        alert('Failed to create application. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStepCircleStyle = (stepNumber: number) => {
    const isActive = currentStep >= stepNumber;
    return {
      ...styles.stepCircle,
      background: isActive
        ? 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)'
        : '#f1f5f9',
      color: isActive ? 'white' : '#94a3b8',
      boxShadow: isActive ? '0 4px 14px rgba(99,102,241,0.3)' : 'none',
      border: isActive ? 'none' : '1.5px solid #e2e8f0',
    };
  };

  const getStepLabelStyle = (stepNumber: number) => {
    return {
      ...styles.stepLabel,
      color: currentStep >= stepNumber ? '#6366f1' : '#94a3b8'
    };
  };

  const getInputStyle = (fieldName: string) => {
    const isDuplicate = duplicateError?.fields.includes(fieldName);
    return {
      ...styles.input,
      ...(errors[fieldName] ? styles.inputError : {}),
      ...(isDuplicate ? { borderColor: '#f59e0b', boxShadow: '0 0 0 3px rgba(245,158,11,0.15)' } : {})
    };
  };

  return (
    <div style={styles.container}>
      <style>{`
        @keyframes submitPulse{
          0%,100%{box-shadow:0 4px 14px rgba(99,102,241,0.3),0 0 0 0 rgba(99,102,241,0.5)}
          50%{box-shadow:0 4px 14px rgba(99,102,241,0.3),0 0 0 10px rgba(99,102,241,0)}
        }
        @keyframes bounceArrow{
          0%,100%{transform:translateY(0)}
          50%{transform:translateY(5px)}
        }
        @keyframes dupSlideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        .btn-pulse{animation:submitPulse 1s ease-in-out 3}
      `}</style>
      <div style={styles.strip} />

      <div style={styles.content}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.badge}>BFSI Hackathon 2026</div>
          <h1 style={styles.title}>New Merchant Application</h1>
          <p style={styles.subtitle}>Complete 2 steps to begin</p>
        </div>

        {/* Progress Steps */}
        <div style={styles.card}>
          <div style={styles.progressContainer}>
            <div style={styles.progressLine}>
              <div style={{
                height: '100%',
                background: 'linear-gradient(90deg, #6366f1 0%, #7c3aed 100%)',
                width: `${((currentStep - 1) / 1) * 100}%`,
                transition: 'width 0.3s',
                borderRadius: '4px',
              }}></div>
            </div>
            {steps.map(step => (
              <div key={step.number} style={styles.stepContainer}>
                <div style={getStepCircleStyle(step.number)}>
                  {currentStep > step.number ? '✓' : step.icon}
                </div>
                <p style={getStepLabelStyle(step.number)}>{step.title}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Form Card */}
        <div style={styles.card}>

          {/* ── Duplicate merchant banner ── */}
          {duplicateError && (
            <div style={{
              background: '#fff7ed',
              border: '1.5px solid #fbbf24',
              borderRadius: '10px',
              padding: '10px 14px',
              marginBottom: '14px',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              animation: 'dupSlideIn 0.25s ease',
            }}>
              <span style={{ fontSize: '18px', flexShrink: 0 }}>⚠️</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '13px', color: '#92400e' }}>
                  An active merchant account already exists with this{' '}
                  {duplicateError.fields.map(f => ({ businessName: 'Business Name', contactEmail: 'Email', contactPhone: 'Phone' }[f] ?? f)).join(' / ')}.
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#b45309' }}>
                  Please use different details — duplicate registrations are not allowed.
                </p>
              </div>
            </div>
          )}

          {/* Step 1: Business Information */}
          {currentStep === 1 && (
            <div>
              <div style={styles.sectionHeader}>
                <div style={{ display:'flex', justifyContent:'center', marginBottom:'6px' }}>
                  <div style={styles.sectionIcon}>🏢</div>
                </div>
                <h2 style={styles.sectionTitle}>Business Information</h2>
                <p style={styles.sectionDesc}>Tell us about your business</p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Business Name *</label>
                <input
                  type="text"
                  name="businessName"
                  value={formData.businessName}
                  onChange={handleChange}
                  placeholder="Enter your business name"
                  style={getInputStyle('businessName')}
                />
                {errors.businessName && <p style={styles.errorText}>{errors.businessName}</p>}
                {!errors.businessName && duplicateError?.fields.includes('businessName') && (
                  <p style={{ ...styles.errorText, color: '#b45309' }}>⚠️ This business name is already registered — please use a different name</p>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Business Type *</label>
                <select
                  name="businessType"
                  value={formData.businessType}
                  onChange={handleChange}
                  style={getInputStyle('businessType')}
                >
                  <option value="">Select business type</option>
                  <option value="RETAIL">🛍️ Retail</option>
                  <option value="ECOMMERCE">🛒 E-commerce</option>
                  <option value="IT_SERVICES">💻 IT Services</option>
                  <option value="MANUFACTURING">🏭 Manufacturing</option>
                  <option value="FINANCE">💰 Finance</option>
                </select>
                {errors.businessType && <p style={styles.errorText}>{errors.businessType}</p>}
              </div>

              {/* Country + City row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Country *</label>
                  <select
                    name="country"
                    value={formData.country}
                    onChange={handleChange}
                    style={getInputStyle('country')}
                  >
                    <option value="">Select country</option>
                    <optgroup label="Asia Pacific">
                      <option value="India">🇮🇳 India</option>
                      <option value="Singapore">🇸🇬 Singapore</option>
                      <option value="Australia">🇦🇺 Australia</option>
                      <option value="Japan">🇯🇵 Japan</option>
                      <option value="China">🇨🇳 China</option>
                      <option value="South Korea">🇰🇷 South Korea</option>
                      <option value="Indonesia">🇮🇩 Indonesia</option>
                      <option value="Malaysia">🇲🇾 Malaysia</option>
                      <option value="Thailand">🇹🇭 Thailand</option>
                      <option value="Philippines">🇵🇭 Philippines</option>
                      <option value="New Zealand">🇳🇿 New Zealand</option>
                      <option value="Bangladesh">🇧🇩 Bangladesh</option>
                      <option value="Sri Lanka">🇱🇰 Sri Lanka</option>
                      <option value="Pakistan">🇵🇰 Pakistan</option>
                    </optgroup>
                    <optgroup label="North America">
                      <option value="United States">🇺🇸 United States</option>
                      <option value="Canada">🇨🇦 Canada</option>
                      <option value="Mexico">🇲🇽 Mexico</option>
                    </optgroup>
                    <optgroup label="Europe">
                      <option value="United Kingdom">🇬🇧 United Kingdom</option>
                      <option value="Germany">🇩🇪 Germany</option>
                      <option value="France">🇫🇷 France</option>
                      <option value="Netherlands">🇳🇱 Netherlands</option>
                      <option value="Sweden">🇸🇪 Sweden</option>
                      <option value="Switzerland">🇨🇭 Switzerland</option>
                      <option value="Italy">🇮🇹 Italy</option>
                      <option value="Spain">🇪🇸 Spain</option>
                      <option value="Poland">🇵🇱 Poland</option>
                      <option value="Portugal">🇵🇹 Portugal</option>
                    </optgroup>
                    <optgroup label="Middle East & Africa">
                      <option value="UAE">🇦🇪 UAE</option>
                      <option value="Saudi Arabia">🇸🇦 Saudi Arabia</option>
                      <option value="Israel">🇮🇱 Israel</option>
                      <option value="Turkey">🇹🇷 Turkey</option>
                      <option value="Egypt">🇪🇬 Egypt</option>
                      <option value="South Africa">🇿🇦 South Africa</option>
                      <option value="Nigeria">🇳🇬 Nigeria</option>
                      <option value="Kenya">🇰🇪 Kenya</option>
                    </optgroup>
                    <optgroup label="Latin America">
                      <option value="Brazil">🇧🇷 Brazil</option>
                      <option value="Argentina">🇦🇷 Argentina</option>
                      <option value="Colombia">🇨🇴 Colombia</option>
                    </optgroup>
                  </select>
                  {errors.country && <p style={styles.errorText}>{errors.country}</p>}
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    City / State
                    <span style={{ color: '#9ca3af', fontWeight: 'normal', fontSize: '11px', marginLeft: '6px' }}>(Optional)</span>
                  </label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    placeholder="e.g. Mumbai, Delhi NCR"
                    style={getInputStyle('city')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Contact Information */}
          {currentStep === 2 && (
            <div>
              <div style={styles.sectionHeader}>
                <div style={{ display:'flex', justifyContent:'center', marginBottom:'6px' }}>
                  <div style={{ ...styles.sectionIcon, background:'linear-gradient(135deg,#eff6ff,#bfdbfe)', border:'1.5px solid #93c5fd', boxShadow:'0 4px 12px rgba(37,99,235,0.2)' }}>📧</div>
                </div>
                <h2 style={styles.sectionTitle}>Contact Information</h2>
                <p style={styles.sectionDesc}>How can we reach you?</p>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Contact Email *</label>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  placeholder="contact@example.com"
                  style={getInputStyle('contactEmail')}
                />
                {errors.contactEmail && <p style={styles.errorText}>{errors.contactEmail}</p>}
                {!errors.contactEmail && duplicateError?.fields.includes('contactEmail') && (
                  <p style={{ ...styles.errorText, color: '#b45309' }}>⚠️ This email is already associated with an active merchant — please use a different email</p>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Contact Phone *</label>
                <input
                  type="tel"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  placeholder="+1 (555) 123-4567"
                  style={getInputStyle('contactPhone')}
                />
                {errors.contactPhone && <p style={styles.errorText}>{errors.contactPhone}</p>}
                {!errors.contactPhone && duplicateError?.fields.includes('contactPhone') && (
                  <p style={{ ...styles.errorText, color: '#b45309' }}>⚠️ This phone number is already associated with an active merchant — please use a different number</p>
                )}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Website <span style={{ color: '#9ca3af', fontWeight: 'normal' }}>(Optional)</span>
                </label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  placeholder="https://example.com"
                  style={styles.input}
                />
              </div>
            </div>
          )}

          {/* Ready-to-submit nudge (step 2 only) */}
          {currentStep === 2 && pulseSubmit && (
            <div style={{ background:'linear-gradient(135deg,#ecfdf5,#d1fae5)',border:'1.5px solid #6ee7b7',borderRadius:'10px',padding:'10px 16px',marginTop:'12px',textAlign:'center' as const }}>
              <div style={{ fontSize:'11px',fontWeight:700,color:'#059669',textTransform:'uppercase' as const,letterSpacing:'0.07em',marginBottom:'4px' }}>✓ All required fields filled</div>
              <div style={{ fontSize:'13px',color:'#065f46',fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:'6px' }}>
                <span style={{ animation:'bounceArrow 0.8s ease-in-out infinite',display:'inline-block' }}>👇</span>
                Click the button below to continue
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div style={styles.buttonContainer}>
            <button
              onClick={currentStep === 1 ? (isAdmin ? () => navigate('/') : undefined) : prevStep}
              style={{ ...styles.btnSecondary, ...(currentStep === 1 && !isAdmin ? { visibility: 'hidden' } : {}) }}
              onMouseOver={(e) => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1'; }}
              onMouseOut={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.color = '#475569'; }}
            >
              ← {currentStep === 1 ? (isAdmin ? 'Cancel' : '') : 'Previous'}
            </button>

            {currentStep < 2 ? (
              <button
                onClick={nextStep}
                disabled={isValidating}
                style={{ ...styles.btnPrimary, opacity: isValidating ? 0.7 : 1, cursor: isValidating ? 'not-allowed' : 'pointer' }}
                onMouseOver={(e) => { if (!isValidating) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,0.35)'; }}}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(99,102,241,0.3)'; }}
              >
                {isValidating ? '⏳ Checking...' : 'Next →'}
              </button>
            ) : (
              <button
                ref={submitBtnRef}
                onClick={handleSubmit}
                disabled={isSubmitting || isValidating || !!duplicateError}
                className={pulseSubmit && !duplicateError ? 'btn-pulse' : ''}
                style={{ ...styles.btnPrimary, opacity: (isSubmitting || isValidating || !!duplicateError) ? 0.5 : 1, cursor: (isSubmitting || isValidating || !!duplicateError) ? 'not-allowed' : 'pointer' }}
              >
                {isSubmitting ? 'Creating...' : isValidating ? '⏳ Checking...' : duplicateError ? '⛔ Cannot Proceed' : 'Continue to Documents →'}
              </button>
            )}
          </div>

          {/* Step Indicator */}
          <div style={styles.stepIndicator}>
            Step {currentStep} of 2
          </div>
        </div>
      </div>
    </div>
  );
};