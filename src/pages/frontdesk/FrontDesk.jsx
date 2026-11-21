import { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useStore } from '../../context/StoreContext';
import { useRbac } from '../../context/RbacContext';
import { inr } from '../../utils/format';
import { api } from '../../services/api';
import PageHead from '../../components/PageHead';
import DataTable from '../../components/DataTable';
import { StatusBadge } from '../../components/Badge';
import SubNav from '../../components/SubNav';

const JOURNEY = [
  ['Booking confirmed', 'Reservation and payment details saved'],
  ['Check-in', 'Verify ID, assign room, record deposit'],
  ['During the stay', 'Extra charges, room service, room changes'],
  ['Check-out', 'Final bill, settle payment, release room'],
  ['Housekeeping', 'Room cleaned and marked ready'],
];

export default function FrontDesk() {
  const { bookings, setBookingStatus, notify, activeTenant, tenant, user } = useStore();
  const { canEdit, canApprove } = useRbac();
  const today = new Date().toISOString().slice(0, 10);

  const [qrUrl, setQrUrl] = useState('');
  const [qrDataUri, setQrDataUri] = useState('');
  const [showQr, setShowQr] = useState(true);
  const [urlMode, setUrlMode] = useState('auto'); // 'auto' | 'custom'
  const [customOrigin, setCustomOrigin] = useState(() => {
    try { return sessionStorage.getItem('stayflow_custom_portal_origin') || ''; } catch { return ''; }
  });
  const [showUrlSettings, setShowUrlSettings] = useState(false);

  const hotelCode = activeTenant?.code || tenant?.code || user?.tenant?.code || 'HOTEL-001';

  // Compute and update QR code
  useEffect(() => {
    // 1. Configured production frontend domain (e.g. Vercel deployment URL from env)
    const configuredProdOrigin = (
      import.meta.env.VITE_FRONTEND_URL ||
      import.meta.env.VITE_PUBLIC_URL ||
      ''
    ).replace(/\/$/, '');

    // Check if currently running on a public internet domain or HTTPS
    const isPublicHost = typeof window !== 'undefined' && (
      window.location.protocol === 'https:' ||
      (window.location.hostname !== 'localhost' &&
       window.location.hostname !== '127.0.0.1' &&
       !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(window.location.hostname))
    );

    // If manual custom origin is provided
    if (urlMode === 'custom' && customOrigin.trim()) {
      const cleanCustom = customOrigin.trim().replace(/\/$/, '');
      const customUrl = `${cleanCustom}/guest-portal?hotel=${encodeURIComponent(hotelCode)}`;
      setQrUrl(customUrl);
      QRCode.toDataURL(customUrl, {
        width: 260,
        margin: 2,
        color: { dark: '#13243a', light: '#ffffff' }
      }).then(setQrDataUri).catch(() => {});
      return;
    }

    // If running in production or on a public domain, use the current public origin
    if (isPublicHost) {
      const publicBase = configuredProdOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
      const prodUrl = `${publicBase}/guest-portal?hotel=${encodeURIComponent(hotelCode)}`;
      setQrUrl(prodUrl);
      QRCode.toDataURL(prodUrl, {
        width: 260,
        margin: 2,
        color: { dark: '#13243a', light: '#ffffff' }
      }).then(setQrDataUri).catch(() => {});
      return;
    }

    // Local development mode:
    // If the page is already accessed via a LAN IP (e.g. http://192.168.1.9:5173), use that origin directly
    if (typeof window !== 'undefined' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(window.location.hostname) && window.location.hostname !== '127.0.0.1') {
      const lanUrl = `${window.location.origin}/guest-portal?hotel=${encodeURIComponent(hotelCode)}`;
      setQrUrl(lanUrl);
      QRCode.toDataURL(lanUrl, {
        width: 260,
        margin: 2,
        color: { dark: '#13243a', light: '#ffffff' }
      }).then(setQrDataUri).catch(() => {});
      return;
    }

    // If accessed via localhost, fetch reachable LAN IP from backend so mobile phones can connect
    const cachedLanIp = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('stayflow_lan_ip') : null;
    const initialFallbackOrigin = cachedLanIp
      ? `http://${cachedLanIp}:${window.location.port || '5173'}`
      : configuredProdOrigin || window.location.origin;
    const initialFallbackUrl = `${initialFallbackOrigin}/guest-portal?hotel=${encodeURIComponent(hotelCode)}`;
    setQrUrl(initialFallbackUrl);
    QRCode.toDataURL(initialFallbackUrl, {
      width: 260,
      margin: 2,
      color: { dark: '#13243a', light: '#ffffff' }
    }).then(setQrDataUri).catch(() => {});

    api(`/api/system/network-info?hotel=${encodeURIComponent(hotelCode)}`)
      .then((data) => {
        let lanIp = data.lan_ip;
        if (lanIp && lanIp !== '127.0.0.1') {
          try { sessionStorage.setItem('stayflow_lan_ip', lanIp); } catch {}
        }
        const port = window.location.port ? `:${window.location.port}` : ':5173';
        const finalBase = (lanIp && lanIp !== '127.0.0.1')
          ? `http://${lanIp}${port}`
          : (data.guest_portal_url ? data.guest_portal_url.split('/guest-portal')[0] : window.location.origin);
        const resolvedUrl = `${finalBase}/guest-portal?hotel=${encodeURIComponent(hotelCode)}`;
        setQrUrl(resolvedUrl);
        return QRCode.toDataURL(resolvedUrl, {
          width: 260,
          margin: 2,
          color: { dark: '#13243a', light: '#ffffff' }
        });
      })
      .then(setQrDataUri)
      .catch(() => {
        // Keep initial fallback url
      });
  }, [hotelCode, urlMode, customOrigin]);

  const handleCopyLink = () => {
    if (qrUrl) {
      navigator.clipboard.writeText(qrUrl);
      notify('Guest Portal URL copied to clipboard!');
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUri) return;
    const a = document.createElement('a');
    a.href = qrDataUri;
    a.download = 'stayflow-guest-checkin-checkout-qr.png';
    a.click();
    notify('QR Code image downloaded');
  };

  const arrivals = bookings.filter(
    (b) => ['Confirmed', 'Pending', 'Modified'].includes(b.st) && b.check_in === today
  );
  const departures = bookings.filter(
    (b) => b.st === 'Checked-in' || (b.check_out === today && b.st === 'Confirmed')
  );

  return (
    <>
      <PageHead title="Front desk" subtitle="Check guests in and out, assign rooms, and settle bills" />
      <SubNav parentPath="/front-desk" />

      {/* Guest Self-Service Check-In & Check-Out QR Code Panel */}
      <div className="panel" style={{ borderLeft: '4px solid var(--teal)', background: 'linear-gradient(to right, #FAFDFD, #FFFFFF)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showQr ? '16px' : '0' }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#0F172A', fontSize: '18px', fontWeight: 700, fontFamily: 'var(--head)' }}>
              <span>📱</span> Guest Express Check-In & Check-Out QR Portal
              <span className="badge" style={{ background: '#d7eeed', color: '#064E3B', fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Single QR Code
              </span>
            </h2>
            <div className="sub" style={{ margin: '4px 0 0', color: '#334155', fontSize: '13px', fontWeight: 500, lineHeight: '1.4' }}>
              One unified QR code for guest verification, ID registration, digital room keys, express check-out, and billing
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => setShowQr(!showQr)}
              style={{ minWidth: '90px' }}
            >
              {showQr ? 'Hide QR' : 'Show QR'}
            </button>
          </div>
        </div>

        {showQr && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center', marginTop: '14px' }}>
            {qrDataUri ? (
              <div style={{ background: '#FFFFFF', padding: '12px', borderRadius: '14px', border: '1px solid var(--line)', boxShadow: '0 4px 14px rgba(0,0,0,0.08)', textAlign: 'center', width: '214px' }}>
                <div style={{ width: '190px', height: '94px', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px', position: 'relative', border: '1px solid #E2E8F0' }}>
                  <img
                    src="/noire_hero.jpg"
                    alt="StayFlow Coastal Retreat"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{ position: 'absolute', bottom: 0, insetInline: 0, padding: '3px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)', color: '#FFFFFF', fontSize: '10px', fontWeight: 700, textAlign: 'left' }}>
                    StayFlow Luxury Retreat
                  </div>
                </div>
                <img
                  src={qrDataUri}
                  alt="Guest Check-In / Check-Out QR Code"
                  style={{ width: '190px', height: '190px', display: 'block', borderRadius: '6px' }}
                />
                <div style={{ fontSize: '12px', color: '#475569', marginTop: '8px', fontWeight: 600 }}>
                  Scan with any mobile camera
                </div>
              </div>
            ) : (
              <div style={{ width: '214px', height: '214px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1F5F9', borderRadius: '12px', color: '#475569', fontWeight: 600 }}>
                <span>Generating QR…</span>
              </div>
            )}

            <div style={{ flex: '1 1 320px' }}>
              <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#1E293B', marginBottom: '14px', fontWeight: 500 }}>
                Place this QR Code at the reception counter or in guest confirmation emails. Guests can scan it on any smartphone to:
              </div>
              <ul style={{ margin: '0 0 16px 20px', padding: 0, fontSize: '13px', lineHeight: '1.7', color: '#334155' }}>
                <li style={{ marginBottom: '6px' }}><strong style={{ color: '#0F172A', fontWeight: 700 }}>Verify Booking:</strong> Securely matches Booking Ref ID, Full Name, and Phone Number.</li>
                <li style={{ marginBottom: '6px' }}><strong style={{ color: '#0F172A', fontWeight: 700 }}>Self Check-In:</strong> Records actual check-in time, ID proof details, and allocates digital room key.</li>
                <li style={{ marginBottom: '6px' }}><strong style={{ color: '#0F172A', fontWeight: 700 }}>Re-scan to Check-Out:</strong> Real-time stay charges calculation (nights, tax, payments) and instant payment settlement.</li>
                <li style={{ marginBottom: '6px' }}><strong style={{ color: '#0F172A', fontWeight: 700 }}>Official Tax Invoice:</strong> Download or print the finalized GST tax invoice with zero duplicate charges.</li>
              </ul>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '9px 12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', fontFamily: 'monospace', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <span style={{ color: '#475569', fontWeight: 700, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>Portal URL:</span>
                  <strong style={{ color: '#0E7C7B', fontWeight: 700, wordBreak: 'break-all', fontSize: '13px' }}>{qrUrl || 'Loading…'}</strong>
                </div>
                <button
                  type="button"
                  className="btn sm ghost"
                  style={{ fontSize: 11, padding: '2px 8px', height: '26px' }}
                  onClick={() => setShowUrlSettings(!showUrlSettings)}
                  title="Configure QR Target URL / Network IP"
                >
                  ⚙️ {showUrlSettings ? 'Close Settings' : 'URL Settings'}
                </button>
              </div>

              {showUrlSettings && (
                <div style={{ background: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '12px 14px', marginBottom: '16px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚙️</span> QR Destination URL Configuration
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginBottom: 10, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="radio"
                        name="urlMode"
                        value="auto"
                        checked={urlMode === 'auto'}
                        onChange={() => setUrlMode('auto')}
                      />
                      <span>Auto-Detect (Production Domain / Wi-Fi LAN IP)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 600 }}>
                      <input
                        type="radio"
                        name="urlMode"
                        value="custom"
                        checked={urlMode === 'custom'}
                        onChange={() => setUrlMode('custom')}
                      />
                      <span>Custom URL / Tunnel (e.g. ngrok, custom IP)</span>
                    </label>
                  </div>
                  {urlMode === 'custom' && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="https://your-custom-domain.com or http://192.168.x.x:5173"
                        value={customOrigin}
                        onChange={(e) => {
                          const val = e.target.value;
                          setCustomOrigin(val);
                          try { sessionStorage.setItem('stayflow_custom_portal_origin', val); } catch {}
                        }}
                        style={{ flex: 1, minWidth: 260, padding: '6px 10px', borderRadius: 6, border: '1px solid #94A3B8', fontSize: 12, fontFamily: 'monospace' }}
                      />
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => {
                          notify('Custom Portal URL applied to QR code!');
                        }}
                      >
                        Apply
                      </button>
                    </div>
                  )}
                  <div style={{ color: '#64748B', marginTop: 6, fontSize: 11 }}>
                    💡 For mobile phone scanning over local Wi-Fi, ensure your phone is connected to the same Wi-Fi network as this computer.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <a
                  href={qrUrl || "/guest-portal"}
                  target="_blank"
                  rel="noreferrer"
                  className="btn sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
                  title="Open Hotel Guest Portal"
                >
                  <span>🔗</span> Open Guest Portal
                </a>
                <button
                  type="button"
                  className="btn sm brass"
                  onClick={handleDownloadQr}
                  disabled={!qrDataUri}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>⬇️</span> Download QR (PNG)
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={handleCopyLink}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <span>📋</span> Copy Link
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="row r-2">
        <div className="panel">
          <h2>Today's arrivals</h2>
          <div className="sub">{arrivals.length} guests expected</div>
          <DataTable
            columns={['Guest', 'Room type', 'Payment', 'Action']}
            rows={arrivals.map((b) => [
              b.guest, b.room, <StatusBadge status={b.pay} />,
              (canEdit('/front-desk') || canApprove('/front-desk')) ? (
                <div style={{ display: 'flex', gap: 6 }} key={`arr-${b.id}`}>
                  <button
                    type="button"
                    className="btn sm"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => { setBookingStatus(b.id, 'Checked-in'); notify(`${b.guest} checked in`); }}
                  >
                    Check in
                  </button>
                </div>
              ) : null,
            ])}
          />
        </div>
        <div className="panel">
          <h2>Today's departures</h2>
          <div className="sub">{departures.length} guests leaving</div>
          <DataTable
            columns={['Guest', 'Room type', 'Bill', 'Action']}
            rows={departures.map((b) => [
              b.guest, b.room, inr(b.amt),
              (canEdit('/front-desk') || canApprove('/front-desk')) ? (
                <div style={{ display: 'flex', gap: 6 }} key={`dep-${b.id}`}>
                  <a
                    href={`/front-desk/final-bill?ref=${encodeURIComponent(b.id)}`}
                    className="btn sm ghost"
                    style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
                    title="View itemized final bill"
                  >
                    📄 Final Bill
                  </a>
                  <button
                    type="button"
                    className="btn sm brass"
                    style={{ fontSize: 11, padding: '4px 8px' }}
                    onClick={() => { setBookingStatus(b.id, 'Checked-out'); notify(`${b.guest} checked out`); }}
                  >
                    Check out
                  </button>
                </div>
              ) : null,
            ])}
          />
        </div>
      </div>
      <div className="panel">
        <h2>Guest journey</h2>
        <div className="sub">The standard front desk workflow</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
          {JOURNEY.map(([title, text], i) => (
            <div key={title} style={{ borderLeft: `3px solid ${i === 1 ? 'var(--brass)' : 'var(--teal)'}`, padding: '2px 12px' }}>
              <b>{title}</b>
              <div className="muted">{text}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
