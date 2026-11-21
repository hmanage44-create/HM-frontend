import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../context/StoreContext';
import { api } from '../services/api';
import { inr, fmtDate } from '../utils/format';
import { executeRazorpayPayment } from '../utils/razorpay';

export default function FinalBillView() {
  const { bookings, guests, activeTenant, tenant, notify } = useStore();
  const location = useLocation();
  const navigate = useNavigate();

  // Extract ?ref= from query string or default to first checked-in booking
  const queryParams = new URLSearchParams(location.search);
  const initialRef = queryParams.get('ref') || '';

  const [selectedRef, setSelectedRef] = useState(initialRef);
  const [billingData, setBillingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Settlement dialog state
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleMethod, setSettleMethod] = useState('Cash');
  const [settleAmount, setSettleAmount] = useState('');
  const [txnRef, setTxnRef] = useState('');
  const [settling, setSettling] = useState(false);

  // Available bookings list for selector
  const activeBookings = bookings && bookings.length > 0 ? bookings : [];

  // If no ref was in URL, select the first checked-in or first booking
  useEffect(() => {
    if (!selectedRef && activeBookings.length > 0) {
      const preferred = activeBookings.find((b) => b.st === 'Checked-in') || activeBookings[0];
      const ref = preferred.reference || preferred.id;
      setSelectedRef(ref);
    }
  }, [activeBookings, selectedRef]);

  // Fetch real-time billing whenever selectedRef changes
  const fetchBilling = async (ref) => {
    if (!ref) return;
    setLoading(true);
    setError('');
    try {
      const res = await api(`/api/bookings/${encodeURIComponent(ref)}/billing`);
      setBillingData(res);
      if (res?.billing?.balance_due != null) {
        setSettleAmount(String(res.billing.balance_due));
      }
    } catch (err) {
      // Fallback to public invoice endpoint
      try {
        const pub = await api(`/api/public/booking/invoice/${encodeURIComponent(ref)}`);
        setBillingData({
          booking_reference: ref,
          guest_name: pub.guest_name,
          guest_phone: pub.guest_phone,
          guest_email: pub.guest_email,
          room_number: pub.room_number,
          room_type: pub.room_type,
          check_in: pub.check_in,
          check_out: pub.check_out,
          status: pub.payment_status,
          billing: {
            nights: pub.nights,
            base_rate: pub.base_rate,
            room_charges: pub.room_charges,
            daily_room_charges: pub.daily_room_charges || [],
            additional_charges: pub.additional_charges,
            services: pub.services || [],
            subtotal: pub.subtotal,
            discount_amount: pub.discount_amount || 0,
            taxable_amount: pub.taxable_amount || pub.subtotal,
            gst_percent: pub.gst_percent || 12,
            tax_amount: pub.tax_amount,
            cgst_amount: (pub.tax_amount || 0) / 2,
            sgst_amount: (pub.tax_amount || 0) / 2,
            total_bill: pub.total_bill,
            amount_paid: pub.amount_paid,
            balance_due: pub.balance_due,
            payment_status: pub.payment_status,
            hotel_name: pub.hotel_name,
            currency: pub.currency,
            payments: pub.payments || pub.billing?.payments || [],
          },
          invoice: pub,
        });
      } catch (fallbackErr) {
        setError(err.message || 'Failed to fetch billing information.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedRef) {
      fetchBilling(selectedRef);
    }
  }, [selectedRef]);

  const handleBookingChange = (e) => {
    const newRef = e.target.value;
    setSelectedRef(newRef);
    navigate(`/front-desk/final-bill?ref=${encodeURIComponent(newRef)}`, { replace: true });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleSettlePayment = async () => {
    const amtNum = Number(settleAmount);
    if (isNaN(amtNum) || amtNum <= 0) {
      notify('Please enter a valid payment amount greater than zero.');
      return;
    }

    setSettling(true);
    try {
      if (settleMethod === 'Razorpay') {
        await executeRazorpayPayment({
          api,
          orderEndpoint: '/api/payments/razorpay/create-order',
          verifyEndpoint: '/api/payments/razorpay/verify',
          orderPayload: {
            booking_reference: selectedRef,
            amount: amtNum,
            notes: { source: 'Front Desk Final Bill' },
          },
          name: currentHotelName,
          description: `Settlement for Folio ${selectedRef}`,
          prefill: {
            name: billingData?.guest_name || '',
            email: billingData?.guest_email || '',
            contact: billingData?.guest_phone || '',
          },
          onSuccess: async () => {
            notify(`Razorpay payment of ${inr(amtNum)} recorded successfully!`);
            setSettleOpen(false);
            setTxnRef('');
            await fetchBilling(selectedRef);
          },
          onError: (err) => {
            notify('Razorpay payment failed: ' + (err.message || 'Transaction error'));
          },
        });
        return;
      }

      await api(`/api/bookings/${encodeURIComponent(selectedRef)}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: amtNum,
          method: settleMethod,
          transaction_ref: txnRef || `FD-${Date.now().toString().slice(-6)}`,
          notes: `Front Desk Final Bill settlement via ${settleMethod}`,
        }),
      });

      notify(`Payment of ${inr(amtNum)} recorded successfully!`);
      setSettleOpen(false);
      setTxnRef('');
      await fetchBilling(selectedRef);
    } catch (err) {
      notify('Payment failed: ' + (err.message || 'Transaction error'));
    } finally {
      setSettling(false);
    }
  };

  const currentHotelName =
    activeTenant?.name ||
    tenant?.name ||
    billingData?.billing?.hotel_name ||
    'StayFlow Luxury Retreat & Suites';

  const hotelAddress =
    activeTenant?.address
      ? `${activeTenant.address}${activeTenant.city ? `, ${activeTenant.city}` : ''}${activeTenant.country ? `, ${activeTenant.country}` : ''}`
      : '104 Coastal Boulevard, Hospitality Zone, Bengaluru 560001, Karnataka';

  const hotelPhone = activeTenant?.contact_phone || '+91 80 4567 8900';
  const hotelEmail = activeTenant?.contact_email || 'frontdesk@stayflowhotel.com';
  const hotelGstin = activeTenant?.gstin || '29AAACH7409R1ZZ';
  const hotelCin = activeTenant?.cin || 'U55101KA2024PTC184200';
  const hotelWeb = 'stayflowhotel.com';

  const billing = billingData?.billing || {};
  const dailyCharges = billing.daily_room_charges || [];
  const services = billing.services || [];
  const balanceDue = Number(billing.balance_due || 0);
  const totalPaid = Number(billing.amount_paid || 0);
  const totalBill = Number(billing.total_bill || 0);
  const isSettled = balanceDue <= 0 && totalBill > 0;
  const payStatus = billing.payment_status || (isSettled ? 'Paid' : totalPaid > 0 ? 'Partial' : 'Pending');

  // Recorded payments derivation
  const recordedPayments = useMemo(() => {
    if (billing?.payments && Array.isArray(billing.payments) && billing.payments.length > 0) {
      return billing.payments;
    }
    if (billingData?.invoice?.payments && Array.isArray(billingData.invoice.payments) && billingData.invoice.payments.length > 0) {
      return billingData.invoice.payments;
    }
    if (totalPaid > 0) {
      return [
        {
          id: 'pay-advance',
          method: billingData?.invoice?.payment_method || 'Advance / Front Desk',
          ref: `REC-${selectedRef ? selectedRef.slice(-6) : '001'}`,
          amount: totalPaid,
          date: billingData?.check_in,
          status: 'Paid',
        },
      ];
    }
    return [];
  }, [billing?.payments, billingData, totalPaid, selectedRef]);

  const issueDateFormatted = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="final-bill-wrapper">
      {/* Top Action & Selection Bar (Hidden in Print) */}
      <div
        className="no-print"
        style={{
          background: 'var(--panel, #1E293B)',
          border: '1px solid var(--line, #334155)',
          borderRadius: 12,
          padding: '14px 18px',
          marginBottom: 20,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink, #F8FAFC)' }}>
            Select Reservation / Guest:
          </label>
          <select
            value={selectedRef}
            onChange={handleBookingChange}
            style={{
              padding: '7px 12px',
              borderRadius: 6,
              border: '1px solid var(--line, #475569)',
              background: 'var(--panel, #0F172A)',
              color: 'var(--ink, #F8FAFC)',
              fontSize: 13,
              fontWeight: 600,
              minWidth: 260,
            }}
          >
            {activeBookings.map((b) => {
              const ref = b.reference || b.id;
              return (
                <option key={b.id} value={ref}>
                  {b.guest} • Room {b.room_number || b.room} ({ref})
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="btn sm ghost"
            onClick={() => fetchBilling(selectedRef)}
            disabled={loading}
            style={{ fontSize: 12 }}
            title="Refresh billing data"
          >
            🔄 Refresh
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {balanceDue > 0 && (
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                setSettleAmount(String(balanceDue));
                setSettleOpen(true);
              }}
              style={{ background: '#10B981', color: '#FFFFFF', fontWeight: 700 }}
            >
              💳 Settle Bill ({inr(balanceDue)})
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            onClick={handlePrint}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#0284C7', color: '#FFF', fontWeight: 600 }}
          >
            🖨️ Print Final Bill
          </button>
          <button
            type="button"
            className="btn sm brass"
            onClick={handlePrint}
            title="Save as PDF via browser print dialog"
          >
            ⬇️ Save as PDF
          </button>
        </div>
      </div>

      {/* Printable Invoice Container */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Compiling itemized final bill...</div>
        </div>
      ) : error ? (
        <div
          style={{
            padding: 20,
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 8,
            color: '#991B1B',
          }}
        >
          <strong>Error loading final bill:</strong> {error}
        </div>
      ) : (
        <div id="printable-final-bill">
          <div className="bill-print-inner">
            {/* SECTION 1: HOTEL HEADER & DOCUMENT METADATA */}
            <div className="bill-print-header">
              <div style={{ maxWidth: '62%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 24, lineHeight: 1 }}>🏨</span>
                  <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                    {currentHotelName}
                  </h1>
                </div>
                <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.45 }}>
                  <div>{hotelAddress}</div>
                  <div>
                    <strong>GSTIN:</strong> {hotelGstin} &nbsp;|&nbsp; <strong>CIN:</strong> {hotelCin}
                  </div>
                  <div>
                    <strong>Phone:</strong> {hotelPhone} &nbsp;|&nbsp; <strong>Email:</strong> {hotelEmail} &nbsp;|&nbsp; <strong>Web:</strong> {hotelWeb}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: '#0284C7',
                    textTransform: 'uppercase',
                    letterSpacing: '0.8px',
                    lineHeight: 1.2,
                  }}
                >
                  FINAL HOTEL BILL / GUEST FOLIO
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginTop: 3 }}>
                  INV-{selectedRef}
                </div>
                <div style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                  Date of Issue: {issueDateFormatted}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '3px 10px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      background: isSettled ? '#DCFCE7' : totalPaid > 0 ? '#FEF3C7' : '#FEE2E2',
                      color: isSettled ? '#15803D' : totalPaid > 0 ? '#B45309' : '#B91C1C',
                      border: `1px solid ${isSettled ? '#86EFAC' : totalPaid > 0 ? '#FCD34D' : '#FCA5A5'}`,
                    }}
                  >
                    {payStatus.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>

            {/* SECTION 2 & 3: INVOICE & STAY INFORMATION */}
            <div className="bill-print-grid">
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#0284C7', marginBottom: 5, letterSpacing: '0.5px' }}>
                  Guest Particulars
                </div>
                <div style={{ fontSize: 11.5, color: '#1E293B', lineHeight: 1.55 }}>
                  <div><strong>Full Name:</strong> {billingData?.guest_name || '—'}</div>
                  <div><strong>Phone Number:</strong> {billingData?.guest_phone || '—'}</div>
                  <div><strong>Email Address:</strong> {billingData?.guest_email || '—'}</div>
                  <div><strong>Identity Proof:</strong> {billingData?.invoice?.id_proof || 'Verified by Front Desk'}</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#0284C7', marginBottom: 5, letterSpacing: '0.5px' }}>
                  Stay & Room Allocation
                </div>
                <div style={{ fontSize: 11.5, color: '#1E293B', lineHeight: 1.55 }}>
                  <div><strong>Booking Reference:</strong> {selectedRef}</div>
                  <div><strong>Room Allocated:</strong> Room {billingData?.room_number || '—'} ({billingData?.room_type || 'Standard'})</div>
                  <div><strong>Check-in:</strong> {billingData?.check_in ? `${billingData.check_in} (14:00 hrs)` : '—'}</div>
                  <div><strong>Check-out:</strong> {billingData?.check_out ? `${billingData.check_out} (11:00 hrs)` : '—'}</div>
                  <div><strong>Duration of Stay:</strong> {billing?.nights || 1} Night(s)</div>
                </div>
              </div>
            </div>

            {/* SECTION 4: ITEMIZED CHARGES TABLE */}
            <div className="bill-print-table-section">
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: '#1E293B',
                  letterSpacing: '0.5px',
                  marginBottom: 6,
                }}
              >
                Itemized Stay & Additional Charges
              </div>

              <table className="bill-print-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>Description / Service</th>
                    <th style={{ width: 120 }}>Category</th>
                    <th style={{ textAlign: 'center', width: 65 }}>Qty</th>
                    <th style={{ textAlign: 'right', width: 95 }}>Rate (₹)</th>
                    <th style={{ textAlign: 'right', width: 105 }}>Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Daily Room Accommodation Charges */}
                  {(dailyCharges.length > 0
                    ? dailyCharges
                    : [
                        {
                          day_number: 1,
                          date_formatted: billingData?.check_in,
                          room_type: billingData?.room_type,
                          room_number: billingData?.room_number,
                          duration: 'Full Day',
                          rate_per_day: billing.base_rate || billing.room_charges,
                          amount: billing.room_charges || 0,
                        },
                      ]
                  ).map((day, idx) => (
                    <tr key={`room-day-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong style={{ color: '#0F172A' }}>Room Accommodation: {day.room_type || billingData?.room_type}</strong>
                        <div style={{ fontSize: 9.5, color: '#64748B' }}>
                          Room #{day.room_number || billingData?.room_number} • Date: {day.date_formatted || day.date} • {day.duration === 'Half Day' ? 'Half Day Stay (50% Rate)' : 'Full Day Stay'}
                        </div>
                      </td>
                      <td style={{ color: '#475569' }}>Accommodation</td>
                      <td style={{ textAlign: 'center' }}>
                        {day.duration === 'Half Day' ? '0.5 Day' : '1 Day'}
                      </td>
                      <td style={{ textAlign: 'right' }}>{inr(day.rate_per_day)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                        {inr(day.amount)}
                      </td>
                    </tr>
                  ))}

                  {/* Additional Services and Guest Charges */}
                  {services.map((svc, sIdx) => {
                    const lineNum = (dailyCharges.length || 1) + sIdx + 1;
                    return (
                      <tr key={svc.id || `svc-${sIdx}`}>
                        <td>{lineNum}</td>
                        <td>
                          <strong style={{ color: '#0F172A' }}>{svc.name || svc.service_name}</strong>
                          <div style={{ fontSize: 9.5, color: '#64748B' }}>
                            {svc.service_date_formatted || svc.service_date ? `Date: ${svc.service_date_formatted || svc.service_date}` : ''}
                            {svc.notes ? ` • ${svc.notes}` : ''}
                          </div>
                        </td>
                        <td style={{ color: '#475569' }}>{svc.category || 'Guest Service'}</td>
                        <td style={{ textAlign: 'center' }}>{svc.quantity || 1}</td>
                        <td style={{ textAlign: 'right' }}>{inr(svc.unit_price || svc.rate_per_unit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                          {inr(svc.total || svc.total_amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* SECTIONS 5 & 6: PAYMENT DETAILS & BILL SUMMARY (2-Column Grid) */}
            <div className="bill-print-columns">
              {/* SECTION 5: PAYMENT DETAILS & RECORDED TRANSACTIONS */}
              <div className="bill-print-box">
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#0284C7',
                    letterSpacing: '0.5px',
                    marginBottom: 8,
                    borderBottom: '1px solid #E2E8F0',
                    paddingBottom: 4,
                  }}
                >
                  Payment Details & Recorded Transactions
                </div>

                {recordedPayments.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, marginBottom: 8 }}>
                    <thead>
                      <tr style={{ color: '#64748B', borderBottom: '1px solid #CBD5E1', textAlign: 'left' }}>
                        <th style={{ padding: '3px 0', fontWeight: 700 }}>Method</th>
                        <th style={{ padding: '3px 0', fontWeight: 700 }}>Receipt / Ref</th>
                        <th style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>Amount (₹)</th>
                        <th style={{ padding: '3px 0', textAlign: 'right', fontWeight: 700 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recordedPayments.map((p, pIdx) => (
                        <tr key={p.id || `pay-${pIdx}`} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '4px 0', fontWeight: 600, color: '#0F172A' }}>
                            {p.method || 'Cash'}
                          </td>
                          <td style={{ padding: '4px 0', color: '#64748B', fontSize: 9.5 }}>
                            {p.ref || p.transaction_reference || `REC-${selectedRef.slice(-4)}`}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 700, color: '#15803D' }}>
                            {inr(p.amount)}
                          </td>
                          <td style={{ padding: '4px 0', textAlign: 'right' }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#15803D', background: '#DCFCE7', padding: '1px 5px', borderRadius: 3 }}>
                              PAID
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 11, color: '#64748B', padding: '10px 0', fontStyle: 'italic' }}>
                    No advance payments recorded. Outstanding balance is payable at front desk upon check-out.
                  </div>
                )}

                <div style={{ borderTop: '1px dashed #CBD5E1', paddingTop: 6, marginTop: 4, fontSize: 11, color: '#475569' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span>Total Amount Paid to Date:</span>
                    <strong style={{ color: '#15803D' }}>{inr(totalPaid)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Payment Fulfillment:</span>
                    <strong style={{ color: isSettled ? '#15803D' : '#B45309' }}>
                      {isSettled ? '100% Fully Settled' : totalPaid > 0 ? 'Partially Settled' : 'Pending Settlement'}
                    </strong>
                  </div>
                </div>

                {balanceDue > 0 && (
                  <div className="no-print" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setSettleAmount(String(balanceDue));
                        setSettleOpen(true);
                      }}
                      style={{ width: '100%', background: '#10B981', color: '#FFF', fontWeight: 700, fontSize: 11 }}
                    >
                      💳 Settle Balance ({inr(balanceDue)})
                    </button>
                  </div>
                )}
              </div>

              {/* SECTION 6: BILL SUMMARY (FINANCIAL CALCULATION) */}
              <div className="bill-print-box">
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#0284C7',
                    letterSpacing: '0.5px',
                    marginBottom: 6,
                    borderBottom: '1px solid #E2E8F0',
                    paddingBottom: 4,
                  }}
                >
                  Bill Summary & Tax Computation
                </div>

                <div className="bill-print-row">
                  <span style={{ color: '#475569' }}>Room Accommodation Charges:</span>
                  <span style={{ fontWeight: 600 }}>{inr(billing.room_charges || 0)}</span>
                </div>

                {Number(billing.additional_charges || 0) > 0 && (
                  <div className="bill-print-row">
                    <span style={{ color: '#475569' }}>Additional Services & Charges:</span>
                    <span style={{ fontWeight: 600 }}>{inr(billing.additional_charges)}</span>
                  </div>
                )}

                <div
                  className="bill-print-row"
                  style={{
                    borderTop: '1px dashed #CBD5E1',
                    marginTop: 3,
                    paddingTop: 3,
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#1E293B' }}>Gross Subtotal:</span>
                  <span style={{ fontWeight: 700 }}>{inr(billing.subtotal || 0)}</span>
                </div>

                {Number(billing.discount_amount || 0) > 0 && (
                  <div className="bill-print-row" style={{ color: '#15803D' }}>
                    <span>Promotional Discount Applied:</span>
                    <span style={{ fontWeight: 700 }}>− {inr(billing.discount_amount)}</span>
                  </div>
                )}

                <div className="bill-print-row">
                  <span style={{ color: '#475569' }}>Taxable Value:</span>
                  <span style={{ fontWeight: 600 }}>{inr(billing.taxable_amount || billing.subtotal || 0)}</span>
                </div>

                <div className="bill-print-row" style={{ color: '#64748B', fontSize: 10 }}>
                  <span>Central GST (CGST @ 6%):</span>
                  <span>{inr(billing.cgst_amount || (billing.tax_amount ? billing.tax_amount / 2 : 0))}</span>
                </div>

                <div className="bill-print-row" style={{ color: '#64748B', fontSize: 10 }}>
                  <span>State GST (SGST @ 6%):</span>
                  <span>{inr(billing.sgst_amount || (billing.tax_amount ? billing.tax_amount / 2 : 0))}</span>
                </div>

                <div className="bill-print-row" style={{ color: '#475569', fontWeight: 600, fontSize: 10.5 }}>
                  <span>Total GST Amount (12%):</span>
                  <span>{inr(billing.tax_amount || 0)}</span>
                </div>

                <div
                  className="bill-print-row"
                  style={{
                    fontSize: 13,
                    fontWeight: 800,
                    borderTop: '2px solid #0F172A',
                    borderBottom: '2px solid #0F172A',
                    marginTop: 4,
                    padding: '5px 0',
                    color: '#0F172A',
                  }}
                >
                  <span>Grand Total Invoice Amount:</span>
                  <span style={{ color: '#0284C7' }}>{inr(totalBill)}</span>
                </div>

                <div className="bill-print-row" style={{ marginTop: 3 }}>
                  <span style={{ color: '#475569' }}>Total Paid to Date:</span>
                  <span style={{ fontWeight: 700, color: '#15803D' }}>{inr(totalPaid)}</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: 5,
                    fontSize: 11.5,
                    fontWeight: 800,
                    marginTop: 5,
                    background: balanceDue > 0 ? '#FEF2F2' : '#F0FDF4',
                    border: `1px solid ${balanceDue > 0 ? '#FCA5A5' : '#86EFAC'}`,
                    color: balanceDue > 0 ? '#B91C1C' : '#15803D',
                  }}
                >
                  <span>Outstanding Balance Due:</span>
                  <span>{inr(balanceDue)}</span>
                </div>
              </div>
            </div>

            {/* SECTION 7: FOOTER & REGULATORY NOTES */}
            <div className="bill-print-footer">
              <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                Thank you for choosing to stay with us at {currentHotelName}!
              </div>
              <div>
                1. Standard check-out time is 11:00 AM. Extensions without prior front-desk confirmation are subject to applicable tariffs.<br />
                2. Goods and Services Tax (GST) is levied as per statutory accommodation rates prescribed by the Government of India.<br />
                3. This is a computer-generated tax folio and invoice verified under StayFlow PMS. No physical signature is required.
              </div>
              <div style={{ marginTop: 3, fontSize: 8.5, color: '#94A3B8', textAlign: 'right' }}>
                StayFlow Hospitality PMS • Verified Official Guest Folio • Generated {issueDateFormatted}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settlement Modal */}
      {settleOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              color: '#0F172A',
              padding: 24,
              borderRadius: 12,
              maxWidth: 420,
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
          >
            <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
              💳 Record Payment / Settle Balance
            </h3>
            <div style={{ fontSize: 13, color: '#64748B', marginBottom: 16 }}>
              Booking Reference: <strong>{selectedRef}</strong> • Guest: <strong>{billingData?.guest_name}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Payment Method</label>
                <select
                  value={settleMethod}
                  onChange={(e) => setSettleMethod(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    marginTop: 4,
                  }}
                >
                  <option value="Cash">Cash</option>
                  <option value="Card">Card (Credit/Debit POS)</option>
                  <option value="UPI">UPI / QR Payment</option>
                  <option value="Razorpay">Razorpay Online</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Amount to Pay (₹)</label>
                <input
                  type="number"
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    marginTop: 4,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Transaction Reference / Receipt</label>
                <input
                  type="text"
                  value={txnRef}
                  onChange={(e) => setTxnRef(e.target.value)}
                  placeholder="e.g. POS-98421 or UPI-Ref"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    marginTop: 4,
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setSettleOpen(false)}
                  disabled={settling}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleSettlePayment}
                  disabled={settling}
                  style={{ background: '#10B981', color: '#FFF', fontWeight: 700 }}
                >
                  {settling ? 'Recording...' : `Confirm & Settle ${inr(settleAmount)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


