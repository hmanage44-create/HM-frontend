import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '../context/StoreContext';
import { inr } from '../utils/format';
import { api } from '../services/api';
import { executeRazorpayPayment } from '../utils/razorpay';
import { validateIdNumber, getExpectedFormatInfo, ID_DOC_TYPES } from '../utils/idValidation';

export default function GuestModal({ guest, onClose, onSaved }) {
  const { addGuest, updateGuest, updateBookingPaymentStatus, notify, bookings, guests, refresh } = useStore();
  const PREDEFINED_ID_TYPES = ['Aadhaar Card', 'PAN Card', 'Driving Licence', 'Passport', 'Voter ID'];

  const parseIdProof = (idStr) => {
    if (!idStr) return { type: 'Aadhaar Card', custom: '', number: '' };
    if (idStr.includes(':')) {
      const parts = idStr.split(':');
      const prefix = parts[0].trim();
      const num = parts.slice(1).join(':').trim();
      if (PREDEFINED_ID_TYPES.some(pt => pt.toLowerCase() === prefix.toLowerCase())) {
        return { type: PREDEFINED_ID_TYPES.find(pt => pt.toLowerCase() === prefix.toLowerCase()) || prefix, custom: '', number: num };
      }
      return { type: 'Others', custom: prefix, number: num };
    }
    for (const pt of PREDEFINED_ID_TYPES) {
      if (idStr.toLowerCase().startsWith(pt.toLowerCase())) {
        const num = idStr.slice(pt.length).replace(/^[-:\s]+/, '').trim();
        return { type: pt, custom: '', number: num };
      }
    }
    return { type: 'Aadhaar Card', custom: '', number: idStr };
  };

  const initialIdData = parseIdProof(guest?.identification_number);
  const [selectedIdType, setSelectedIdType] = useState(initialIdData.type);
  const [specifyIdType, setSpecifyIdType] = useState(initialIdData.custom);
  const [idNumber, setIdNumber] = useState(initialIdData.number);

  const [formData, setFormData] = useState(() => ({
    id: guest?.id ? Number(guest.id) : null,
    full_name: guest?.full_name || '',
    phone: guest?.phone || '',
    email: guest?.email || '',
    identification_number: guest?.identification_number || '',
    tier: guest?.tier || 'Silver',
    notes: guest?.notes || '',
    preferences: guest?.preferences || '',
  }));

  // Stay Billing & Payment Status state
  const [paymentStatus, setPaymentStatus] = useState(guest?.payStatus || guest?.payment_status || 'Pending');
  const [paymentMethod, setPaymentMethod] = useState('Cash');

  const [submitting, setSubmitting] = useState(false);
  const [detecting, setDetecting] = useState(false);

  // Auto-detected stay and reservation metrics from the hotel database
  const [autoDetectedData, setAutoDetectedData] = useState({
    matched: false,
    guest_id: guest?.id ? Number(guest.id) : null,
    total_stays: guest?.total_stays != null ? Number(guest.total_stays) : 0,
    last_visit: guest?.last_visit && guest.last_visit !== '—' ? guest.last_visit : 'No stays recorded yet',
    room_number: guest?.room_number && guest.room_number !== '—' ? guest.room_number : '—',
    room_type: guest?.room_type && guest.room_type !== '—' ? guest.room_type : '—',
    nights: guest?.nights ? Number(guest.nights) : 0,
    reservation: null,
    existingContact: null,
    message: ''
  });

  const debounceTimerRef = useRef(null);

  // Unique known guest names for dropdown autocomplete
  const knownGuestNames = useMemo(() => {
    const names = new Set();
    (guests || []).forEach((g) => {
      if (g?.full_name?.trim()) names.add(g.full_name.trim());
    });
    (bookings || []).forEach((b) => {
      if (b?.guest?.trim()) names.add(b.guest.trim());
    });
    return Array.from(names);
  }, [guests, bookings]);

  // Lookup guest from SQL database and client state
  const lookupGuest = async (nameQuery, specificGuestId = null) => {
    const trimmed = (nameQuery || '').trim();
    if (!trimmed && !specificGuestId) {
      setAutoDetectedData({
        matched: false,
        guest_id: null,
        total_stays: 0,
        last_visit: 'No stays recorded yet',
        room_number: '—',
        room_type: '—',
        nights: 0,
        reservation: null,
        existingContact: null,
        message: ''
      });
      return;
    }

    // Fast client-side preliminary detection from current tenant state
    const matchedClientGuest = (guests || []).find((g) => {
      if (specificGuestId && Number(g.id) === Number(specificGuestId)) return true;
      return g?.full_name?.trim().toLowerCase() === trimmed.toLowerCase();
    });

    const clientStays = (bookings || []).filter((b) => {
      if (!b) return false;
      if (matchedClientGuest && String(b.guest_id) === String(matchedClientGuest.id)) return true;
      if (b.guest && b.guest.trim().toLowerCase() === trimmed.toLowerCase()) return true;
      return false;
    });

    if (matchedClientGuest || clientStays.length > 0) {
      const latestClientStay = clientStays.at(-1);
      setAutoDetectedData((prev) => ({
        ...prev,
        matched: true,
        guest_id: matchedClientGuest?.id || prev.guest_id,
        total_stays: matchedClientGuest?.total_stays != null ? Number(matchedClientGuest.total_stays) : clientStays.length,
        last_visit: matchedClientGuest?.last_visit && matchedClientGuest.last_visit !== '—'
          ? matchedClientGuest.last_visit
          : (latestClientStay?.check_out || latestClientStay?.out || latestClientStay?.check_in || latestClientStay?.in || prev.last_visit),
        room_number: latestClientStay?.room_number || latestClientStay?.room || matchedClientGuest?.room_number || prev.room_number,
        room_type: latestClientStay?.room_type || matchedClientGuest?.room_type || prev.room_type,
        nights: latestClientStay?.nights ? Number(latestClientStay.nights) : prev.nights,
      }));
    }

    // Authoritative SQL database query via /api/guests/lookup
    setDetecting(true);
    try {
      const url = specificGuestId
        ? `/api/guests/lookup?guest_id=${specificGuestId}`
        : `/api/guests/lookup?name=${encodeURIComponent(trimmed)}`;
      const dbResult = await api(url);

      if (dbResult && dbResult.found) {
        setAutoDetectedData({
          matched: true,
          guest_id: dbResult.guest_id,
          total_stays: dbResult.total_stays,
          last_visit: dbResult.last_visit,
          room_number: dbResult.room_number,
          room_type: dbResult.room_type,
          nights: dbResult.nights,
          reservation: dbResult.reservation,
          existingContact: {
            phone: dbResult.phone || '',
            email: dbResult.email || '',
            identification_number: dbResult.identification_number || '',
            notes: dbResult.notes || '',
            preferences: dbResult.preferences || ''
          },
          message: ''
        });

        // Auto-update tier if available from DB
        if (dbResult.tier) {
          setFormData((prev) => ({ ...prev, tier: dbResult.tier }));
        }
      } else {
        setAutoDetectedData({
          matched: false,
          guest_id: null,
          total_stays: 0,
          last_visit: 'No stays recorded yet',
          room_number: '—',
          room_type: '—',
          nights: 0,
          reservation: null,
          existingContact: null,
          message: 'No active stay or reservation found in this hotel (New Guest)'
        });
      }
    } catch {
      // Retain client-side values if backend query encounters network glitch
    } finally {
      setDetecting(false);
    }
  };

  // Trigger detection on input with debounce
  const handleNameChange = (val) => {
    setFormData((prev) => ({ ...prev, full_name: val }));

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      lookupGuest(val);
    }, 250);
  };

  // Initial detection when modal opens with a guest name
  useEffect(() => {
    if (guest?.full_name || guest?.id) {
      lookupGuest(guest.full_name, guest.id);
    }
  }, [guest?.id, guest?.full_name]);

  // Optional pre-fill for existing contact fields without replacing manual edits
  const handlePrefillExistingContact = () => {
    if (!autoDetectedData.existingContact) return;
    setFormData((prev) => ({
      ...prev,
      phone: prev.phone || autoDetectedData.existingContact.phone || '',
      email: prev.email || autoDetectedData.existingContact.email || '',
      identification_number: prev.identification_number || autoDetectedData.existingContact.identification_number || '',
      notes: prev.notes || autoDetectedData.existingContact.notes || '',
      preferences: prev.preferences || autoDetectedData.existingContact.preferences || ''
    }));
    notify('Loaded existing contact details');
  };

  // Resolve active reservation and billing metrics
  const activeReservation = guest?.lastStay || autoDetectedData.reservation || (bookings || []).find((b) =>
    (formData.id && String(b.guest_id) === String(formData.id)) ||
    (formData.full_name && b.guest && b.guest.trim().toLowerCase() === formData.full_name.trim().toLowerCase())
  );
  const activeRef = guest?.booking_reference || activeReservation?.reference || activeReservation?.id;
  const totalBill = guest?.totalBill != null ? Number(guest.totalBill) : (activeReservation ? Number(activeReservation.amt || activeReservation.total_amount || 0) : 0);
  const amtPaid = guest?.amtPaid != null ? Number(guest.amtPaid) : (paymentStatus === 'Paid' ? totalBill : 0);
  const balanceDue = guest?.balance != null ? Number(guest.balance) : Math.max(0, totalBill - amtPaid);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedName = formData.full_name.trim();
    if (!trimmedName) {
      notify('Please enter guest full name');
      return;
    }
    if (trimmedName.length < 3) {
      notify('Guest full name must be at least 3 characters.');
      return;
    }
    if (/\d/.test(trimmedName)) {
      notify('Guest full name must contain letters only and cannot contain numbers.');
      return;
    }
    if (!/^[A-Za-z\s'\.\-]+$/.test(trimmedName)) {
      notify('Guest full name must contain letters, spaces, hyphens, or apostrophes only.');
      return;
    }
    if (formData.email && formData.email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(formData.email.trim())) {
        notify('Please enter a valid email address.');
        return;
      }
    }
    if (formData.phone && formData.phone.trim()) {
      const digits = formData.phone.replace(/[^\d+]/g, '');
      if (digits.length < 8) {
        notify('Please enter a valid phone number (at least 8 digits).');
        return;
      }
    }
    // Mandatory ID Document & Number Format Validation
    const valResult = validateIdNumber(selectedIdType, idNumber, specifyIdType);
    if (!valResult.valid) {
      notify(valResult.error);
      return;
    }
    const finalIdStr = valResult.fullFormatted;

    setSubmitting(true);
    try {
      const payload = {
        full_name: formData.full_name.trim(),
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        identification_number: finalIdStr,
        tier: formData.tier || 'Silver',
        notes: formData.notes.trim() || '',
        preferences: formData.preferences || '',
      };

      let ok = false;
      const targetId = formData.id || (autoDetectedData.matched ? autoDetectedData.guest_id : null);
      if (targetId) {
        ok = await updateGuest(targetId, payload);
      } else {
        const res = await addGuest(payload);
        ok = Boolean(res);
      }

      // Synchronize payment status update if associated with an active reservation
      if (ok) {
        if (activeRef && paymentStatus === 'Paid' && paymentMethod === 'Razorpay' && balanceDue > 0) {
          try {
            await executeRazorpayPayment({
              api,
              orderEndpoint: '/api/payments/razorpay/create-order',
              verifyEndpoint: '/api/payments/razorpay/verify',
              orderPayload: {
                booking_reference: activeRef,
                amount: balanceDue > 0 ? balanceDue : totalBill,
                notes: { source: 'Guest Registration Payment' }
              },
              name: 'StayFlow Hotel',
              description: `Payment for Guest ${formData.full_name}`,
              prefill: {
                name: formData.full_name,
                email: formData.email,
                contact: formData.phone
              },
              onSuccess: async () => {
                notify('✓ Razorpay payment captured & verified!');
                await refresh?.();
                onSaved?.();
                onClose();
              },
              onError: (err) => {
                notify('Razorpay payment failed: ' + (err.message || 'Payment error'));
              }
            });
            return;
          } catch (rErr) {
            console.error('Razorpay popup note:', rErr);
          }
        } else if (activeRef && paymentStatus) {
          try {
            await updateBookingPaymentStatus?.(
              activeRef,
              paymentStatus,
              paymentMethod,
              paymentStatus === 'Paid' ? (balanceDue > 0 ? balanceDue : totalBill) : null
            );
          } catch (pErr) {
            console.error('Payment status sync note:', pErr);
          }
        }
        await refresh?.();
        onSaved?.();
        onClose();
      }
    } catch (err) {
      notify(err.message || 'Failed to save guest');
    } finally {
      setSubmitting(false);
    }
  };

  const isEditing = Boolean(formData.id);

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 9999,
        padding: 16,
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="panel"
        style={{
          width: '100%',
          maxWidth: 620,
          background: 'var(--panel)',
          borderRadius: 12,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          border: '1px solid var(--line)',
          maxHeight: '92vh',
          overflowY: 'auto',
          color: 'var(--ink)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>
              {isEditing ? `Edit Guest: ${formData.full_name || ''}` : 'Add Guest'}
            </h2>
            <div className="sub" style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
              {isEditing ? 'Update guest contact, loyalty tier, and stay billing' : 'Register or link a guest in the hotel SQL database'}
            </div>
          </div>
          <button type="button" className="btn sm ghost" onClick={onClose} style={{ color: 'var(--muted)' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Guest ID & Tier Row */}
          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Guest ID</span>
                <span style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 500 }}>System Generated</span>
              </label>
              <input
                type="text"
                readOnly
                disabled
                value={
                  formData.id
                    ? `GST-${String(formData.id).padStart(4, '0')}`
                    : (autoDetectedData.matched && autoDetectedData.guest_id
                        ? `GST-${String(autoDetectedData.guest_id).padStart(4, '0')} (Existing)`
                        : 'Auto-generated on save')
                }
                style={{
                  background: 'var(--panel-alt)',
                  cursor: 'not-allowed',
                  color: (formData.id || autoDetectedData.matched) ? 'var(--brass)' : 'var(--muted)',
                  fontWeight: 600,
                  border: '1px dashed var(--line)',
                }}
              />
            </div>

            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Tier</label>
              <select
                value={formData.tier}
                onChange={(e) => setFormData(prev => ({ ...prev, tier: e.target.value }))}
                style={{ width: '100%', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
              >
                <option value="Silver">Silver (Standard)</option>
                <option value="Gold">Gold</option>
                <option value="Platinum">Platinum</option>
                <option value="VIP">VIP</option>
              </select>
            </div>
          </div>

          {/* Guest Name Entry with Suggestion Autocomplete */}
          <div className="field" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}>
              <span>Guest Name *</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Type or select to auto-detect stay records</span>
            </label>
            <input
              required
              list="guest-name-suggestions"
              placeholder="e.g. Balaji V or Akash"
              value={formData.full_name}
              onChange={(e) => handleNameChange(e.target.value)}
              autoComplete="off"
              style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
            />
            <datalist id="guest-name-suggestions">
              {knownGuestNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {/* Automatically Detected Stay & History Metrics */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--panel-alt)',
              border: autoDetectedData.matched ? '1px solid var(--teal)' : '1px solid var(--line)',
              marginBottom: 14,
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: autoDetectedData.matched ? 'var(--teal)' : 'var(--muted)' }}>
                Stay History & Reservation (Auto-Detected)
              </div>
              {detecting && (
                <span style={{ fontSize: 11, color: 'var(--teal)' }}>Checking database…</span>
              )}
              {!detecting && autoDetectedData.matched && (
                <span className="tag" style={{ background: 'var(--teal-soft)', color: 'var(--teal)', border: '1px solid var(--teal)', fontWeight: 600, fontSize: 11, padding: '2px 8px' }}>
                  ⚡ Matched Hotel Record
                </span>
              )}
              {!detecting && !autoDetectedData.matched && formData.full_name.trim().length >= 2 && (
                <span className="tag" style={{ background: 'var(--panel)', color: 'var(--muted)', border: '1px solid var(--line)', fontSize: 11, padding: '2px 8px' }}>
                  ℹ️ No previous stays (New Guest)
                </span>
              )}
            </div>

            {/* Metrics Grid: Total Stays, Last Visit, Room Number, Room Type, Nights */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8 }}>
              {/* Total Stays */}
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Total Stays</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="tag" style={{ background: 'var(--teal-soft)', color: 'var(--teal)', fontWeight: 700, fontSize: 11, padding: '2px 6px' }}>
                    {autoDetectedData.total_stays} {autoDetectedData.total_stays === 1 ? 'Stay' : 'Stays'}
                  </span>
                </div>
              </div>

              {/* Last Visit */}
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Last Visit</div>
                <div style={{ fontWeight: 600, fontSize: 11, color: autoDetectedData.last_visit !== 'No stays recorded yet' ? 'var(--ink)' : 'var(--muted)' }}>
                  {autoDetectedData.last_visit}
                </div>
              </div>

              {/* Current/Latest Room Number */}
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Room Number</div>
                <div style={{ fontWeight: 700, fontSize: 11, color: autoDetectedData.room_number !== '—' ? 'var(--brass)' : 'var(--muted)' }}>
                  {autoDetectedData.room_number !== '—' ? (autoDetectedData.room_number.toLowerCase().startsWith('room') ? autoDetectedData.room_number : `Room ${autoDetectedData.room_number}`) : '—'}
                </div>
              </div>

              {/* Room Type */}
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Room Type</div>
                <div style={{ fontWeight: 600, fontSize: 11, color: autoDetectedData.room_type !== '—' ? 'var(--ink)' : 'var(--muted)' }}>
                  {autoDetectedData.room_type}
                </div>
              </div>

              {/* Number of Stay Days / Nights */}
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>Stay Duration</div>
                <div style={{ fontWeight: 600, fontSize: 11, color: autoDetectedData.nights > 0 ? 'var(--ink)' : 'var(--muted)' }}>
                  {autoDetectedData.nights > 0 ? `${autoDetectedData.nights} ${autoDetectedData.nights === 1 ? 'Night' : 'Nights'}` : '—'}
                </div>
              </div>
            </div>

            {/* Reservation / Booking Details Card */}
            {autoDetectedData.reservation && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 10px',
                  background: 'var(--bg)',
                  borderRadius: 6,
                  border: '1px dashed var(--line)',
                  fontSize: 11,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: 'var(--brass)' }}>
                    Ref: {autoDetectedData.reservation.reference}
                  </span>
                  <span className="tag" style={{ fontSize: 10, padding: '1px 5px', fontWeight: 600 }}>
                    {autoDetectedData.reservation.status}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '4px 8px', color: 'var(--muted)' }}>
                  <div>📅 Check-in: <strong style={{ color: 'var(--ink)' }}>{autoDetectedData.reservation.check_in}</strong></div>
                  <div>📅 Check-out: <strong style={{ color: 'var(--ink)' }}>{autoDetectedData.reservation.check_out}</strong></div>
                  <div>🏷️ Source: <span style={{ color: 'var(--ink)' }}>{autoDetectedData.reservation.source}</span></div>
                  <div>
                    💰 Total: <strong style={{ color: 'var(--ink)' }}>₹{Number(autoDetectedData.reservation.total_amount || 0).toLocaleString()}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Stay Billing & Payment Status Section ── */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              background: 'var(--panel-alt)',
              border: '1px solid var(--line)',
              marginBottom: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--brass)' }}>
                Stay Billing & Payment Status
              </span>
              {activeRef && (
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Booking Ref: <strong style={{ color: 'var(--teal)' }}>{activeRef}</strong>
                </span>
              )}
            </div>

            <div className="grid2" style={{ marginBottom: 10 }}>
              <div className="field">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Payment Status</label>
                <select
                  value={paymentStatus}
                  onChange={(e) => setPaymentStatus(e.target.value)}
                  style={{ width: '100%', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                >
                  <option value="Paid">Paid (Full Payment Settled)</option>
                  <option value="Pending">Pending (Payment Outstanding)</option>
                  <option value="Partially Paid">Partially Paid</option>
                </select>
              </div>

              {paymentStatus === 'Paid' && (
                <div className="field">
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Settlement Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    style={{ width: '100%', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                  >
                    <option value="Cash">Cash</option>
                    <option value="Card">Card</option>
                    <option value="UPI">UPI</option>
                    <option value="Razorpay">Razorpay</option>
                  </select>
                </div>
              )}
            </div>

            {/* Billing Summary Bar */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Total Bill</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>{inr(totalBill)}</div>
              </div>
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Amount Paid</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{inr(amtPaid)}</div>
              </div>
              <div style={{ background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line)', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>Balance Due</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: balanceDue > 0 ? 'var(--red)' : 'var(--green)' }}>{inr(balanceDue)}</div>
              </div>
            </div>
          </div>

          {/* Manual Contact Fields */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
              Guest Contact & Identification (Manual)
            </span>
            {autoDetectedData.existingContact && (autoDetectedData.existingContact.phone || autoDetectedData.existingContact.email) && (!formData.phone || !formData.email) && (
              <button
                type="button"
                className="btn sm ghost"
                style={{ fontSize: 10, padding: '2px 8px', color: 'var(--teal)' }}
                onClick={handlePrefillExistingContact}
              >
                📋 Load existing contact info
              </button>
            )}
          </div>

          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Phone</label>
              <input
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
              />
            </div>
            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Email</label>
              <input
                type="email"
                placeholder="e.g. guest@example.com"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
              />
            </div>
          </div>

          <div className="grid2" style={{ marginBottom: 14 }}>
            <div className="field">
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                ID Type <span style={{ color: 'var(--red, #ef4444)' }}>*</span>
              </label>
              <select
                value={selectedIdType}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedIdType(val);
                  if (val !== 'Others') setSpecifyIdType('');
                }}
                style={{ width: '100%', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
              >
                <option value="Aadhaar Card">Aadhaar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Driving Licence">Driving Licence</option>
                <option value="Passport">Passport</option>
                <option value="Voter ID">Voter ID</option>
                <option value="Others">Others</option>
              </select>
            </div>
            {selectedIdType === 'Others' && (
              <div className="field">
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                  Specify ID Type <span style={{ color: 'var(--red, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Government Employee ID, OCI Card"
                  value={specifyIdType}
                  onChange={(e) => setSpecifyIdType(e.target.value)}
                  required
                  style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                />
              </div>
            )}
            <div className="field" style={selectedIdType === 'Others' ? { gridColumn: 'span 2' } : {}}>
              {(() => {
                const info = getExpectedFormatInfo(selectedIdType);
                return (
                  <>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                      {info.label} <span style={{ color: 'var(--red, #ef4444)' }}>*</span>
                    </label>
                    <input
                      placeholder={`e.g. ${info.placeholder}`}
                      value={idNumber}
                      maxLength={info.maxLength}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (['PAN Card', 'Passport', 'Voter ID', 'Driving Licence'].includes(selectedIdType)) {
                          val = val.toUpperCase();
                        }
                        setIdNumber(val);
                      }}
                      required
                      style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
                    />
                    <small style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                      {info.hint}
                    </small>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Notes / Preferences (Manual) */}
          <div className="field" style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Notes / Preferences</label>
            <textarea
              rows={2}
              placeholder="e.g. Quiet room preferred, high floor, allergy requests"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              style={{ width: '100%', resize: 'vertical', background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={submitting}>
              {submitting ? 'Saving…' : (isEditing ? 'Update Guest' : 'Save Guest')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
