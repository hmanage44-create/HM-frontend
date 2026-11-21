import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../services/api';
import { useStore } from '../../context/StoreContext';
import { useRbac } from '../../context/RbacContext';
import Icon from '../../components/Icon';
import PageHead from '../../components/PageHead';

// Baseline 9 Project Phases Specification - All 9 Phases Completed (100%)
const INITIAL_PHASES = [
  { id: 1, phase_number: 1, name: 'Requirements & Project Planning', completed: 100, pending: 0, status: 'Completed' },
  { id: 2, phase_number: 2, name: 'Architecture, Database & Multi-Tenancy', completed: 100, pending: 0, status: 'Completed' },
  { id: 3, phase_number: 3, name: 'Authentication, RBAC & User Management', completed: 100, pending: 0, status: 'Completed' },
  { id: 4, phase_number: 4, name: 'Front Office & Reservations', completed: 100, pending: 0, status: 'Completed' },
  { id: 5, phase_number: 5, name: 'Rooms, Housekeeping & Guests', completed: 100, pending: 0, status: 'Completed' },
  { id: 6, phase_number: 6, name: 'F&B, POS & KOT', completed: 100, pending: 0, status: 'Completed' },
  { id: 7, phase_number: 7, name: 'Operations, Procurement, Security & Engineering', completed: 100, pending: 0, status: 'Completed' },
  { id: 8, phase_number: 8, name: 'Finance, HR & Administration', completed: 100, pending: 0, status: 'Completed' },
  { id: 9, phase_number: 9, name: 'Reports & Analytics', completed: 100, pending: 0, status: 'Completed' },
];

export default function ProjectProgress() {
  const { user, notify, activeTenant, tenant } = useStore();
  const { canEdit, canonicalRole } = useRbac();

  const [phases, setPhases] = useState(INITIAL_PHASES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingPhase, setEditingPhase] = useState(null);
  const [editValue, setEditValue] = useState(0);
  const [editError, setEditError] = useState('');

  const hotelName = activeTenant?.name || tenant?.name || user?.tenant?.name || 'StayFlow Platform';
  const isSuperAdmin = Boolean(user?.is_super_admin || user?.role === 'SUPER_ADMIN');
  const userRole = (canonicalRole || user?.role || '').toUpperCase();
  const hasEditPermission = isSuperAdmin || userRole === 'ADMIN' || userRole === 'GENERAL_MANAGER' || canEdit('/settings') || canEdit('/project-progress');

  // Load project progress from backend API
  const fetchProgress = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api('/api/project-progress');
      if (res && Array.isArray(res.phases) && res.phases.length > 0) {
        // Strictly filter out any Phase 10 entries and sort 1 to 9
        const cleanPhases = res.phases
          .filter((p) => Number(p.phase_number) !== 10 && !String(p.name || '').toLowerCase().includes('phase 10') && !String(p.name || '').toLowerCase().includes('ai receptionist'))
          .sort((a, b) => Number(a.phase_number) - Number(b.phase_number))
          .slice(0, 9);
        setPhases(cleanPhases);
      } else {
        setPhases(INITIAL_PHASES);
      }
    } catch (err) {
      console.warn('Could not load progress from API, using verified default baseline:', err);
      setPhases(INITIAL_PHASES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  // Single Source of Truth Dynamic Calculations across Exactly 9 Phases
  const summary = useMemo(() => {
    // Strictly filter out any Phase 10 entries and sort 1 to 9
    const activePhases = phases
      .filter((p) => Number(p.phase_number) !== 10 && !String(p.name || '').toLowerCase().includes('phase 10') && !String(p.name || '').toLowerCase().includes('ai receptionist'))
      .sort((a, b) => Number(a.phase_number) - Number(b.phase_number))
      .slice(0, 9);

    const total = activePhases.length || 9;
    const sumCompleted = activePhases.reduce((acc, p) => acc + Number(p.completed || 0), 0);
    const overallCompleted = total > 0 ? Number((sumCompleted / total).toFixed(2)) : 0;
    const overallPending = Number((100 - overallCompleted).toFixed(2));
    const overallCompletedRounded = Math.round(overallCompleted);
    const overallPendingRounded = Math.round(overallPending);

    const completedCount = activePhases.filter((p) => Number(p.completed) === 100).length;
    const inProgressCount = activePhases.filter((p) => Number(p.completed) > 0 && Number(p.completed) < 100).length;
    const notStartedCount = activePhases.filter((p) => Number(p.completed) === 0).length;

    return {
      activePhases,
      totalPhases: total,
      overallCompleted,
      overallPending,
      overallCompletedRounded,
      overallPendingRounded,
      completedCount,
      inProgressCount,
      notStartedCount,
    };
  }, [phases]);

  // Open edit modal for a specific phase
  const handleOpenEdit = (phase) => {
    if (!hasEditPermission) {
      notify('You do not have permission to edit project progress.');
      return;
    }
    setEditingPhase(phase);
    setEditValue(phase.completed);
    setEditError('');
  };

  // Save updated phase value
  const handleSaveEdit = async () => {
    if (!editingPhase) return;

    const num = Number(editValue);
    if (isNaN(num) || num < 0 || num > 100) {
      setEditError('Completion percentage must be a valid number between 0 and 100.');
      return;
    }

    try {
      setSaving(true);
      setEditError('');

      const cleanCompleted = Math.round(num * 100) / 100;
      const cleanPending = Math.round((100 - cleanCompleted) * 100) / 100;
      const status = cleanCompleted === 100 ? 'Completed' : cleanCompleted > 0 ? 'In Progress' : 'Not Started';

      // Update local state immediately for instant feedback
      const updatedPhases = phases.map((p) =>
        p.phase_number === editingPhase.phase_number
          ? { ...p, completed: cleanCompleted, pending: cleanPending, status }
          : p
      );
      setPhases(updatedPhases);

      // Persist to backend API
      const res = await api('/api/project-progress', {
        method: 'PUT',
        body: JSON.stringify({
          phases: [
            {
              phase_number: editingPhase.phase_number,
              name: editingPhase.name,
              completed: cleanCompleted,
            },
          ],
        }),
      });

      if (res && Array.isArray(res.phases)) {
        const cleanPhases = res.phases
          .filter((p) => Number(p.phase_number) !== 10 && !String(p.name || '').toLowerCase().includes('phase 10') && !String(p.name || '').toLowerCase().includes('ai receptionist'))
          .sort((a, b) => Number(a.phase_number) - Number(b.phase_number))
          .slice(0, 9);
        setPhases(cleanPhases);
      }

      notify(`Phase ${editingPhase.phase_number} (${editingPhase.name}) progress updated to ${cleanCompleted}%`);
      setEditingPhase(null);
    } catch (err) {
      setEditError(err.message || 'Failed to save progress update');
      notify(err.message || 'Failed to save progress update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '24px 20px', maxWidth: 1280, margin: '0 auto' }}>
      <PageHead
        title="Project Progress Dashboard"
        subtitle={`System architecture milestones, implementation phases, and completion metrics · ${hotelName}`}
      />

      {/* Top Controls & Status Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(201, 158, 77, 0.12)',
            border: '1px solid var(--brass, #c99e4d)',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--brass, #c99e4d)',
          }}>
            🏢 {isSuperAdmin ? 'Platform Super Administration' : hotelName}
          </div>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(14, 124, 123, 0.15)',
            border: '1px solid var(--teal, #0e7c7b)',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--teal, #0e7c7b)',
          }}>
            ✓ Exactly 9 Core Phases (Phase 10 Excluded)
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="btn ghost sm"
            onClick={fetchProgress}
            disabled={loading}
            style={{ height: 34, padding: '0 14px', borderRadius: 8 }}
            title="Reload progress metrics from database"
          >
            <Icon name="refresh" className={loading ? 'spin' : ''} style={{ width: 14, height: 14 }} />
            <span>{loading ? 'Refreshing…' : 'Refresh Metrics'}</span>
          </button>
        </div>
      </div>

      {/* ── 1. Executive Summary Cards Grid ─────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        {/* Card 1: Overall Completion */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Overall Completed</span>
            <span style={{ fontSize: 18 }}>📈</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--teal, #0e7c7b)' }}>
            {summary.overallCompletedRounded}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Exact: <b>{summary.overallCompleted.toFixed(2)}%</b> across 9 phases
          </div>
          <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, Math.max(0, summary.overallCompleted))}%`, height: '100%', background: 'var(--teal, #0e7c7b)' }} />
          </div>
        </div>

        {/* Card 2: Overall Pending */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Overall Pending</span>
            <span style={{ fontSize: 18 }}>⏳</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--brass, #d97706)' }}>
            {summary.overallPendingRounded}%
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Exact: <b>{summary.overallPending.toFixed(2)}%</b> remaining
          </div>
          <div style={{ marginTop: 10, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, Math.max(0, summary.overallPending))}%`, height: '100%', background: 'var(--brass, #d97706)' }} />
          </div>
        </div>

        {/* Card 3: Completed Phases */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Completed Phases</span>
            <span style={{ fontSize: 18 }}>✅</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--green, #10b981)' }}>
            {summary.completedCount}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>/ {summary.totalPhases}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--green, #10b981)', marginTop: 4 }}>
            ● 100% finished milestones
          </div>
        </div>

        {/* Card 4: In-Progress Phases */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>In-Progress Phases</span>
            <span style={{ fontSize: 18 }}>⚙️</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--brass, #d97706)' }}>
            {summary.inProgressCount}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>/ {summary.totalPhases}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Active engineering workflows
          </div>
        </div>

        {/* Card 5: Not-Started Phases */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Not-Started Phases</span>
            <span style={{ fontSize: 18 }}>⏹️</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--ink)' }}>
            {summary.notStartedCount}
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>/ {summary.totalPhases}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            Pending commencement
          </div>
        </div>

        {/* Card 6: Total Phases */}
        <div className="panel" style={{ padding: 18, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase' }}>Total Project Phases</span>
            <span style={{ fontSize: 18 }}>📊</span>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8, color: 'var(--head-color, #fff)' }}>
            {summary.totalPhases}
          </div>
          <div style={{ fontSize: 12, color: 'var(--teal, #0e7c7b)', marginTop: 4 }}>
            Phases 1 through 9
          </div>
        </div>
      </div>

      {/* ── 2. Master Progress Bar ─────────────────────────────────────────── */}
      <div className="panel" style={{ padding: '20px 24px', marginBottom: 24, border: '1px solid var(--line)', borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--head-color, #fff)' }}>
              Overall Project Milestone Progression
            </h3>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>(Calculated dynamically from 9 phases)</span>
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal, #0e7c7b)' }}>
            {summary.overallCompletedRounded}% Complete ({summary.overallCompleted.toFixed(2)}%)
          </div>
        </div>

        <div style={{
          height: 16,
          borderRadius: 8,
          background: 'var(--line, rgba(255,255,255,0.08))',
          overflow: 'hidden',
          display: 'flex',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)',
        }}>
          <div
            style={{
              width: `${Math.min(100, Math.max(0, summary.overallCompleted))}%`,
              background: 'linear-gradient(90deg, var(--teal, #0e7c7b) 0%, #10b981 100%)',
              transition: 'width 0.4s ease',
            }}
            title={`Completed: ${summary.overallCompleted.toFixed(2)}%`}
          />
          <div
            style={{
              width: `${Math.min(100, Math.max(0, summary.overallPending))}%`,
              background: 'rgba(217, 119, 6, 0.25)',
              transition: 'width 0.4s ease',
            }}
            title={`Pending: ${summary.overallPending.toFixed(2)}%`}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span>0% (Project Start)</span>
          <span>50% (Midway)</span>
          <span>100% (Production Target)</span>
        </div>
      </div>

      {/* ── 3. Exact 9 Project Phases Table ────────────────────────────────── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 24 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel-alt, rgba(255,255,255,0.02))',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--head-color, #fff)' }}>
              Project Phases Breakdown (Phases 1 to 9)
            </h2>
            <p style={{ margin: '3px 0 0', color: 'var(--sub, #9ca3af)', fontSize: 12 }}>
              Phase 9 – Reports & Analytics is the final phase. Phase 10 is excluded from this dashboard.
            </p>
          </div>
          {hasEditPermission && (
            <span style={{ fontSize: 12, color: 'var(--brass, #c99e4d)', fontWeight: 600 }}>
              ✎ Click "Update Progress" on any phase to modify completion percentage
            </span>
          )}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
                <th style={{ padding: '12px 16px', width: 60, textAlign: 'center' }}>#</th>
                <th style={{ padding: '12px 20px', minWidth: 260 }}>Project Phase</th>
                <th style={{ padding: '12px 16px', width: 110, textAlign: 'right' }}>Completed</th>
                <th style={{ padding: '12px 16px', width: 110, textAlign: 'right' }}>Pending</th>
                <th style={{ padding: '12px 20px', minWidth: 220 }}>Progress Visual</th>
                <th style={{ padding: '12px 16px', width: 140, textAlign: 'center' }}>Status</th>
                {hasEditPermission && (
                  <th style={{ padding: '12px 20px', width: 130, textAlign: 'right' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {summary.activePhases.map((phase) => {
                const comp = Number(phase.completed);
                const pend = Number(phase.pending);
                const isComplete = comp === 100;
                const statusColor = isComplete
                  ? { bg: 'rgba(16, 185, 129, 0.15)', text: '#10b981', border: '#10b981' }
                  : comp > 0
                  ? { bg: 'rgba(217, 119, 6, 0.15)', text: '#d97706', border: '#d97706' }
                  : { bg: 'rgba(156, 163, 175, 0.15)', text: '#9ca3af', border: '#9ca3af' };

                return (
                  <tr
                    key={phase.phase_number}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    {/* 1. Sequential Phase Number */}
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: 700, color: 'var(--brass, #c99e4d)' }}>
                      {phase.phase_number}
                    </td>

                    {/* 2. Full Phase Name */}
                    <td style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--head-color, #fff)' }}>
                      {phase.name}
                    </td>

                    {/* 3. Completed Percentage */}
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: isComplete ? 'var(--green, #10b981)' : 'var(--teal, #0e7c7b)' }}>
                      {comp}%
                    </td>

                    {/* 4. Pending Percentage */}
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 600, color: pend > 0 ? 'var(--brass, #d97706)' : 'var(--muted)' }}>
                      {pend}%
                    </td>

                    {/* 5. Progress Bar */}
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ height: 8, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, comp))}%`,
                            height: '100%',
                            background: isComplete ? 'var(--green, #10b981)' : 'var(--teal, #0e7c7b)',
                            borderRadius: 4,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                    </td>

                    {/* 6. Status Badge */}
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: statusColor.bg,
                        color: statusColor.text,
                        border: `1px solid ${statusColor.border}`,
                      }}>
                        {phase.status || (isComplete ? 'Completed' : comp > 0 ? 'In Progress' : 'Not Started')}
                      </span>
                    </td>

                    {/* 7. Action Button */}
                    {hasEditPermission && (
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn sm outline"
                          onClick={() => handleOpenEdit(phase)}
                          style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6 }}
                          title={`Update progress for Phase ${phase.phase_number}`}
                        >
                          ✎ Update
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. Architectural Note Regarding Phase 10 Exclusion ─────────────── */}
      <div style={{
        padding: '16px 20px',
        borderRadius: 8,
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        fontSize: 13,
        color: 'var(--sub, #9ca3af)',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--head-color, #fff)' }}>🔒 Architectural Scope Note:</strong> Phase 10 (AI Receptionist Integration & Automation) is excluded from the core StayFlow project progress calculations and summary metrics above. All AI Receptionist endpoints, M2M webhook contracts, and integrations remain fully active, deployed, and managed independently within the dedicated <a href="/integrations" style={{ color: 'var(--teal, #0e7c7b)', fontWeight: 600 }}>AI Receptionist Integration Module</a>.
      </div>

      {/* ── 5. Edit Phase Progress Modal ────────────────────────────────────── */}
      {editingPhase && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          zIndex: 9999,
          padding: 20,
        }}>
          <div className="panel" style={{
            maxWidth: 480,
            width: '100%',
            padding: 24,
            borderRadius: 12,
            border: '1px solid var(--line)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📊</span>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--head-color, #fff)' }}>
                  Update Phase Progress
                </h3>
              </div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setEditingPhase(null)}
                style={{ padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ fontSize: 13, color: 'var(--sub, #9ca3af)', margin: '0 0 18px' }}>
              Phase {editingPhase.phase_number}: <strong style={{ color: 'var(--head-color, #fff)' }}>{editingPhase.name}</strong>
            </p>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--head-color, #fff)' }}>
                Completion Percentage (0% to 100%)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    setEditError('');
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 48px 10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'var(--bg, #111)',
                    color: 'var(--text, #fff)',
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                />
                <span style={{
                  position: 'absolute',
                  right: 14,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontWeight: 700,
                  color: 'var(--teal, #0e7c7b)',
                }}>
                  %
                </span>
              </div>

              {/* Automatic pending calculation preview */}
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Completed: <b>{Number(editValue) || 0}%</b></span>
                <span>Pending: <b>{Math.max(0, Math.min(100, 100 - (Number(editValue) || 0)))}%</b></span>
              </div>
            </div>

            {editError && (
              <div style={{
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid var(--red, #ef4444)',
                color: 'var(--red, #ef4444)',
                fontSize: 12,
                marginBottom: 16,
              }}>
                ⚠ {editError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setEditingPhase(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleSaveEdit}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Progress'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

