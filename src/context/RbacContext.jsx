import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../services/api';
import { useStore } from './StoreContext';
import { DEFAULT_ROLES_FALLBACK, MODULES_META_FALLBACK } from '../data/defaultRoles';

const RbacContext = createContext(null);

export const useRbac = () => {
  const ctx = useContext(RbacContext);
  if (!ctx) throw new Error('useRbac must be used within an <RbacProvider>');
  return ctx;
};

export function RbacProvider({ children }) {
  const { user, notify } = useStore();
  const [roles, setRoles] = useState(DEFAULT_ROLES_FALLBACK);
  const [modulesMeta, setModulesMeta] = useState(MODULES_META_FALLBACK);
  const [simulatedRole, setSimulatedRole] = useState(null);
  const [loadingRoles, setLoadingRoles] = useState(false);

  // Clean up any old stale cache
  useEffect(() => {
    try { localStorage.removeItem('stayflow_custom_roles'); } catch {}
  }, []);

  // Load roles & modules metadata from backend
  const loadRbacData = useCallback(async () => {
    try {
      const [rolesData, metaData] = await Promise.all([
        api('/api/rbac/roles').catch(() => null),
        api('/api/rbac/permissions-meta').catch(() => null),
      ]);
      if (rolesData && Array.isArray(rolesData) && rolesData.length > 0) {
        setRoles(rolesData);
      }
      if (metaData && Array.isArray(metaData) && metaData.length > 0) {
        setModulesMeta(metaData);
      }
    } catch (err) {
      console.warn('Backend RBAC fetch notice:', err);
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    loadRbacData();
    const handleSync = () => {
      loadRbacData();
    };
    window.addEventListener('stayflow_rbac_updated', handleSync);
    window.addEventListener('storage', (e) => {
      if (e.key === 'stayflow_rbac_sync') handleSync();
    });
    window.addEventListener('focus', handleSync);
    const interval = setInterval(handleSync, 30000);
    return () => {
      window.removeEventListener('stayflow_rbac_updated', handleSync);
      window.removeEventListener('storage', handleSync);
      window.removeEventListener('focus', handleSync);
      clearInterval(interval);
    };
  }, [loadRbacData]);

  // Actual database role of logged-in user
  const userRole = (user?.role || 'ADMIN').toUpperCase();

  // Effective role considering simulation
  const effectiveRole = simulatedRole ? simulatedRole.toUpperCase() : userRole;

  // Canonical role mapping to resolve any aliases or custom titles
  const roleAliases = {
    'MANAGER': 'GENERAL_MANAGER',
    'HOTEL_MANAGER': 'GENERAL_MANAGER',
    'GM': 'GENERAL_MANAGER',
    'FRONT_DESK_STAFF': 'FRONT_DESK',
    'RECEPTION': 'FRONT_DESK',
    'NIGHT_AUDITOR': 'FRONT_DESK',
    'STAFF': 'FRONT_DESK',
    'FINANCE_MANAGER': 'FINANCE',
    'ACCOUNTS': 'FINANCE',
    'ACCOUNTANT': 'FINANCE',
    'HR': 'HUMAN_RESOURCES',
    'FB': 'FOOD_BEVERAGE',
    'MAINTENANCE': 'ENGINEERING',
    'REVENUE': 'REVENUE_MANAGER',
    'REVENUE_MANAGEMENT': 'REVENUE_MANAGER',
    'REVENUE_MANAGER': 'REVENUE_MANAGER',
    'RESERVATIONS': 'RESERVATION_MANAGER',
    'RESERVATION_MANAGER': 'RESERVATION_MANAGER',
  };
  const canonicalRole = roleAliases[effectiveRole] || effectiveRole;

  // Active role object - prioritizing database role permissions from roles list or authenticated user
  const activeRoleObj = useMemo(() => {
    // 1. Direct database match from roles list
    const foundInDb = roles.find((r) => r.code === canonicalRole || r.code === effectiveRole);
    if (foundInDb) {
      return foundInDb;
    }

    // 2. Active user's runtime permissions from /api/auth/me or /api/auth/login
    if (user && (user.role === effectiveRole || user.role === canonicalRole) && user.permissions) {
      return {
        code: canonicalRole,
        name: canonicalRole.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        permissions: user.permissions,
      };
    }

    // 3. Only if backend roles have not finished loading yet, use fallback default
    if (loadingRoles || roles.length === 0) {
      const fallback = DEFAULT_ROLES_FALLBACK.find((r) => r.code === canonicalRole || r.code === effectiveRole);
      if (fallback) return fallback;
    }

    // 4. Default: empty permissions (secure default-deny)
    return {
      code: canonicalRole,
      name: canonicalRole.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      permissions: {},
    };
  }, [roles, loadingRoles, effectiveRole, canonicalRole, user]);

  // Check granular permission
  const can = useCallback((action, path = '/') => {
    // 1. Admin and Super Admin have full superuser access
    if (canonicalRole === 'ADMIN' || canonicalRole === 'SUPER_ADMIN' || user?.is_super_admin) {
      return true;
    }

    // 2. Customer role access rules
    if (canonicalRole === 'CUSTOMER' || canonicalRole === 'GUEST') {
      const norm = (path || '/').split('?')[0].replace(/\/+$/, '') || '/';
      return norm === '/' || norm.startsWith('/customer') || norm.startsWith('/guest-portal') || norm === '/customer-amenities';
    }

    const norm = (path || '/').split('?')[0].replace(/\/+$/, '') || '/';
    const perms = activeRoleObj?.permissions || {};

    // 3. If role has no permissions object or all permissions are disabled, default deny
    if (!perms || typeof perms !== 'object' || Object.keys(perms).length === 0) {
      return false;
    }

    // 4. Dashboard permission is independently controlled
    if (norm === '/') {
      return Boolean(perms['/'] && perms['/'][action] === true);
    }

    const segments = norm.split('/').filter(Boolean);

    // 5. Parent-Child hierarchy for submodules
    if (segments.length > 1) {
      const parentPath = '/' + segments[0];
      const parentPerm = perms[parentPath];

      // If parent module is explicitly disabled, ALL child features must be inaccessible
      if (parentPerm && (parentPerm.view === false || parentPerm === false)) {
        return false;
      }

      // Check if submodule itself has explicit permission configured
      if (perms[norm] && typeof perms[norm][action] === 'boolean') {
        return perms[norm][action];
      }

      // If submodule not explicitly configured, inherit from parent module permission
      if (parentPerm && typeof parentPerm[action] === 'boolean') {
        return parentPerm[action];
      }

      return false;
    }

    // 6. Parent module check
    if (perms[norm] && typeof perms[norm][action] === 'boolean') {
      return perms[norm][action];
    }

    // 7. Default deny: If not explicitly granted, deny access
    return false;
  }, [canonicalRole, activeRoleObj, user]);

  const canView = useCallback((path) => can('view', path), [can]);
  const canCreate = useCallback((path) => can('create', path), [can]);
  const canEdit = useCallback((path) => can('edit', path), [can]);
  const canDelete = useCallback((path) => can('delete', path), [can]);
  const canApprove = useCallback((path) => can('approve', path), [can]);
  const canExport = useCallback((path) => can('export', path), [can]);

  // Save role permissions directly to backend database
  const saveRolePermissions = useCallback(async (roleId, updatedPermissions) => {
    try {
      const res = await api(`/api/rbac/roles/${roleId}`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: updatedPermissions }),
      });

      // Refetch latest roles and permissions from backend to load exact saved state
      const freshRoles = await api('/api/rbac/roles').catch(() => null);
      if (freshRoles && Array.isArray(freshRoles)) {
        setRoles(freshRoles);
      } else {
        setRoles((prev) =>
          prev.map((r) => (r.id === roleId ? { ...r, permissions: updatedPermissions } : r))
        );
      }

      // If active user belongs to this role, update their runtime permissions directly
      const roleObj = (freshRoles || roles).find((r) => r.id === roleId);
      if (user && roleObj && (user.role === roleObj.code || user.role === roleObj.name)) {
        user.permissions = updatedPermissions;
      }

      try {
        localStorage.setItem('stayflow_rbac_sync', String(Date.now()));
        window.dispatchEvent(new CustomEvent('stayflow_rbac_updated'));
      } catch {}

      notify(`Permissions updated and saved for role ${roleObj ? roleObj.name : ''}`);
      return res || { id: roleId, permissions: updatedPermissions };
    } catch (err) {
      notify(err.message || 'Failed to save permissions');
      throw err;
    }
  }, [roles, user, notify]);

  // Create new role
  const createRole = useCallback(async (roleData) => {
    try {
      const res = await api('/api/rbac/roles', {
        method: 'POST',
        body: JSON.stringify(roleData),
      }).catch(() => null);

      if (res) {
        await loadRbacData();
      } else {
        const created = {
          id: Date.now(),
          name: roleData.name,
          code: roleData.code || roleData.name.toUpperCase().replace(/\s+/g, '_'),
          description: roleData.description || '',
          is_system: false,
          user_count: 0,
          permissions: roleData.permissions || {},
        };
        setRoles((prev) => [...prev, created]);
      }

      notify(`Role "${roleData.name}" created successfully`);
      return res;
    } catch (err) {
      notify(err.message || 'Failed to create role');
      throw err;
    }
  }, [loadRbacData, notify]);

  // Delete role
  const deleteRole = useCallback(async (roleId) => {
    try {
      await api(`/api/rbac/roles/${roleId}`, {
        method: 'DELETE',
      }).catch(() => null);

      await loadRbacData();
      notify('Role deleted successfully');
    } catch (err) {
      notify(err.message || 'Failed to delete role');
      throw err;
    }
  }, [loadRbacData, notify]);

  // Assign user to role
  const assignUserRole = useCallback(async (userId, roleCode) => {
    try {
      const res = await api(`/api/rbac/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: roleCode }),
      }).catch(() => null);
      await loadRbacData();
      notify(`Assigned role ${roleCode} to user`);
      return res;
    } catch (err) {
      notify(err.message || 'Failed to assign role');
      throw err;
    }
  }, [loadRbacData, notify]);

  // Reset default roles
  const resetDefaults = useCallback(async () => {
    try {
      await api('/api/rbac/reset-defaults', { method: 'POST' }).catch(() => null);
      await loadRbacData();
      notify('Reset all default roles and permissions');
    } catch (err) {
      notify(err.message || 'Failed to reset defaults');
    }
  }, [loadRbacData, notify]);

  const value = useMemo(() => ({
    roles,
    modulesMeta,
    userRole,
    effectiveRole,
    canonicalRole,
    simulatedRole,
    setSimulatedRole,
    activeRoleObj,
    loadingRoles,
    loadRbacData,
    can,
    canView,
    canCreate,
    canEdit,
    canDelete,
    canApprove,
    canExport,
    saveRolePermissions,
    createRole,
    deleteRole,
    assignUserRole,
    resetDefaults,
  }), [
    roles,
    modulesMeta,
    userRole,
    effectiveRole,
    canonicalRole,
    simulatedRole,
    activeRoleObj,
    loadingRoles,
    loadRbacData,
    can,
    canView,
    canCreate,
    canEdit,
    canDelete,
    canApprove,
    canExport,
    saveRolePermissions,
    createRole,
    deleteRole,
    assignUserRole,
    resetDefaults,
  ]);

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}
