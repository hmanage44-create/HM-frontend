import React from 'react';
import { useParams } from 'react-router-dom';
import { useRbac } from '../../context/RbacContext';
import { useStore } from '../../context/StoreContext';
import Dashboard from '../Dashboard'; // Admin & Default full hotel dashboard
import GeneralManagerDashboard from './GeneralManagerDashboard';
import RevenueManagerDashboard from './RevenueManagerDashboard';
import ReservationManagerDashboard from './ReservationManagerDashboard';
import FrontDeskDashboard from './FrontDeskDashboard';
import HousekeepingDashboard from './HousekeepingDashboard';
import FinanceDashboard from './FinanceDashboard';
import HrDashboard from './HrDashboard';
import FbDashboard from './FbDashboard';
import SalesMarketingDashboard from './SalesMarketingDashboard';
import EngineeringDashboard from './EngineeringDashboard';
import ProcurementDashboard from './ProcurementDashboard';
import GuestServicesDashboard from './GuestServicesDashboard';
import SecurityDashboard from './SecurityDashboard';
import CustomerAmenities from '../customer/CustomerAmenities';

function AccessDeniedPanel({ moduleName, path }) {
  const { logout } = useStore();
  return (
    <div style={{ padding: '32px 20px', maxWidth: 700, margin: '40px auto' }}>
      <div className="panel" style={{ textAlign: 'center', padding: '60px 24px', borderRadius: 12 }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.12)', color: 'var(--red, #ef4444)',
          display: 'grid', placeItems: 'center', margin: '0 auto 18px', fontSize: 28
        }}>
          🔒
        </div>
        <h2 style={{ fontSize: 20, marginBottom: 8, color: 'var(--head-color, #fff)' }}>
          Access Restricted (403)
        </h2>
        <p style={{ maxWidth: 480, margin: '0 auto 24px', color: 'var(--sub, #9ca3af)', fontSize: 14, lineHeight: 1.6 }}>
          Your role does not have permission to access the <b>{moduleName}</b> operations module ({path}).
          Please contact an administrator to request access.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn secondary" onClick={() => logout ? logout() : (window.location.href = '/login')}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RoleDashboard() {
  const { effectiveRole, canonicalRole, canView } = useRbac();
  const { user } = useStore();
  const { role: routeRole } = useParams();

  const slugMap = {
    'admin': 'ADMIN',
    'general-manager': 'GENERAL_MANAGER',
    'hotel-manager': 'GENERAL_MANAGER',
    'manager': 'GENERAL_MANAGER',
    'gm': 'GENERAL_MANAGER',
    'revenue-manager': 'REVENUE_MANAGER',
    'revenue': 'REVENUE_MANAGER',
    'reservation-manager': 'RESERVATION_MANAGER',
    'reservation': 'RESERVATION_MANAGER',
    'front-desk': 'FRONT_DESK',
    'reception': 'FRONT_DESK',
    'front-office': 'FRONT_DESK',
    'night-auditor': 'FRONT_DESK',
    'housekeeping': 'HOUSEKEEPING',
    'finance': 'FINANCE',
    'finance-manager': 'FINANCE',
    'accounts': 'FINANCE',
    'hr': 'HUMAN_RESOURCES',
    'human-resources': 'HUMAN_RESOURCES',
    'fb': 'FOOD_BEVERAGE',
    'food-beverage': 'FOOD_BEVERAGE',
    'restaurant': 'FOOD_BEVERAGE',
    'sales-marketing': 'SALES_MARKETING',
    'engineering': 'ENGINEERING',
    'maintenance': 'ENGINEERING',
    'procurement': 'PROCUREMENT',
    'guest-services': 'GUEST_SERVICES',
    'security': 'SECURITY',
    'customer': 'CUSTOMER',
    'guest': 'CUSTOMER',
  };

  // Determine target department role
  let targetRole = canonicalRole || effectiveRole || user?.role || 'ADMIN';
  const isCustRole = (user?.role || '').toUpperCase() === 'CUSTOMER' ||
                     (canonicalRole || '').toUpperCase() === 'CUSTOMER' ||
                     (effectiveRole || '').toUpperCase() === 'CUSTOMER';
  const isSysAdmin = (effectiveRole === 'ADMIN' || effectiveRole === 'SUPER_ADMIN' || user?.is_super_admin);

  if (isCustRole) {
    targetRole = 'CUSTOMER';
  } else if (routeRole && slugMap[routeRole.toLowerCase()]) {
    const requested = slugMap[routeRole.toLowerCase()];
    if (isSysAdmin || requested === canonicalRole || requested === effectiveRole) {
      targetRole = requested;
    }
  } else if (!routeRole && user?.assigned_dashboard && slugMap[user.assigned_dashboard.toLowerCase()]) {
    targetRole = slugMap[user.assigned_dashboard.toLowerCase()];
  }

  const normalized = (targetRole || '').toUpperCase().trim();

  switch (normalized) {
    case 'CUSTOMER':
    case 'GUEST':
      return <CustomerAmenities defaultTab="my-reservation" />;
    case 'GENERAL_MANAGER':
    case 'MANAGER':
    case 'HOTEL_MANAGER':
      return <GeneralManagerDashboard />;
    case 'REVENUE_MANAGER':
    case 'REVENUE':
      return <RevenueManagerDashboard />;
    case 'RESERVATION_MANAGER':
    case 'RESERVATIONS':
      return <ReservationManagerDashboard />;
    case 'FRONT_DESK':
    case 'RECEPTION':
    case 'FRONT_OFFICE':
    case 'NIGHT_AUDITOR':
      if (!canView('/front-desk')) return <AccessDeniedPanel moduleName="Front Desk" path="/front-desk" />;
      return <FrontDeskDashboard />;
    case 'HOUSEKEEPING':
      if (!canView('/housekeeping')) return <AccessDeniedPanel moduleName="Housekeeping" path="/housekeeping" />;
      return <HousekeepingDashboard />;
    case 'FINANCE':
    case 'FINANCE_MANAGER':
    case 'ACCOUNTS':
    case 'ACCOUNTANT':
      if (!canView('/finance')) return <AccessDeniedPanel moduleName="Finance" path="/finance" />;
      return <FinanceDashboard />;
    case 'HUMAN_RESOURCES':
    case 'HR':
      if (!canView('/human-resources')) return <AccessDeniedPanel moduleName="Human Resources" path="/human-resources" />;
      return <HrDashboard />;
    case 'FOOD_BEVERAGE':
    case 'FB':
    case 'FOOD_AND_BEVERAGE':
    case 'RESTAURANT':
    case 'KITCHEN':
      if (!canView('/food-beverage')) return <AccessDeniedPanel moduleName="Food & Beverage" path="/food-beverage" />;
      return <FbDashboard />;
    case 'SALES_MARKETING':
    case 'SALES':
    case 'MARKETING':
      if (!canView('/sales-marketing')) return <AccessDeniedPanel moduleName="Sales & Marketing" path="/sales-marketing" />;
      return <SalesMarketingDashboard />;
    case 'ENGINEERING':
    case 'MAINTENANCE':
      if (!canView('/engineering')) return <AccessDeniedPanel moduleName="Engineering" path="/engineering" />;
      return <EngineeringDashboard />;
    case 'PROCUREMENT':
    case 'PURCHASING':
      if (!canView('/procurement')) return <AccessDeniedPanel moduleName="Procurement" path="/procurement" />;
      return <ProcurementDashboard />;
    case 'GUEST_SERVICES':
    case 'CONCIERGE':
      if (!canView('/guest-services')) return <AccessDeniedPanel moduleName="Guest Services" path="/guest-services" />;
      return <GuestServicesDashboard />;
    case 'SECURITY':
      if (!canView('/security')) return <AccessDeniedPanel moduleName="Security" path="/security" />;
      return <SecurityDashboard />;
    case 'STAFF':
      if (!canView('/front-desk')) return <AccessDeniedPanel moduleName="Front Desk" path="/front-desk" />;
      return <FrontDeskDashboard />;
    case 'ADMIN':
    case 'SUPER_ADMIN':
    default:
      return <Dashboard />;
  }
}

