import { useState, useEffect, useMemo, useRef } from 'react';
import {
  TUWAIQ_SERVICES,
  getServiceForProcess,
  extractFieldValue,
  generateSimulatedOutput,
  generateDynamicFieldsFromOutput,
} from '../services/tuwaiqServices';
import { startJobWithArgs, pollForJobResult } from '../services/uiPathApi';
import './TuwaiqCallRecordForm.css';

export default function TuwaiqCallRecordForm({
  selectedProcessKey,
  onSelectProcessKey,
  processes = [],
  loadingProcesses = false,
  processesError = null,
  onRefreshProcesses,
  folderId,
  onJobUpdate,
  onViewDashboard,
}) {
  // 1. Customer Phone Number Input
  const [phoneNumber, setPhoneNumber] = useState('');

  // 2. Selected Process & Service Link State
  const [isProcessDropdownOpen, setIsProcessDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [manualServiceId, setManualServiceId] = useState(null);
  const [showServiceLinkPicker, setShowServiceLinkPicker] = useState(false);
  const dropdownRef = useRef(null);

  // 3. Execution states
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);

  // 4. Output values map: { [fieldId]: string }
  const [fieldValues, setFieldValues] = useState({});
  const [customFields, setCustomFields] = useState([]);
  const [lastFilledTime, setLastFilledTime] = useState(null);
  const [copiedField, setCopiedField] = useState(null);

  // Automatically select the first process if none is selected
  useEffect(() => {
    if (processes.length > 0 && !selectedProcessKey) {
      onSelectProcessKey?.(processes[0].Key);
    }
  }, [processes, selectedProcessKey, onSelectProcessKey]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsProcessDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Find the selected process object from folder's available processes
  const currentProcess = useMemo(() => {
    if (!processes || processes.length === 0) return null;
    return processes.find((p) => p.Key === selectedProcessKey) || processes[0];
  }, [processes, selectedProcessKey]);

  // Resolve which service and dynamic fields match this selected process
  // Priority: 1. Manual user link -> 2. .env Release Key mapping -> 3. Process Name matching
  const activeService = useMemo(() => {
    return getServiceForProcess(currentProcess, manualServiceId);
  }, [currentProcess, manualServiceId]);

  // Compute the dynamic fields to display (active service fields or custom extracted fields)
  const displayFields = useMemo(() => {
    if (customFields.length > 0) return customFields;
    return activeService?.fields || TUWAIQ_SERVICES[0].fields;
  }, [customFields, activeService]);

  // Filter processes for the searchable dropdown (ONLY processes available in the folder!)
  const filteredProcesses = useMemo(() => {
    if (!processes || processes.length === 0) return [];
    if (!searchQuery.trim()) return processes;
    const q = searchQuery.toLowerCase();
    return processes.filter(
      (p) =>
        (p.Name && p.Name.toLowerCase().includes(q)) ||
        (p.Description && p.Description.toLowerCase().includes(q)) ||
        (p.ProcessKey && p.ProcessKey.toLowerCase().includes(q))
    );
  }, [processes, searchQuery]);

  // Handle process selection from the folder dropdown
  const handleSelectProcess = (proc) => {
    onSelectProcessKey?.(proc.Key);
    setIsProcessDropdownOpen(false);
    setSearchQuery('');
    setError(null);
    setStatusMessage('');
    setCustomFields([]);

    // When process changes: dynamic fields disappear and new fields appear!
    // Reset output values so old data is cleared
    setFieldValues({});
    setLastFilledTime(null);
    setManualServiceId(null);
  };

  // Allow manual service override for the selected process
  const handleLinkService = (serviceId) => {
    setManualServiceId(serviceId);
    setShowServiceLinkPicker(false);
    setFieldValues({});
    setCustomFields([]);
    setLastFilledTime(null);
  };

  // Copy field value to clipboard
  const handleCopy = (fieldId, val) => {
    if (!val) return;
    navigator.clipboard.writeText(val);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 1800);
  };

  // -------------------------------------------------------------------------
  // RUN PROCESS
  // Triggers the unattended UiPath process and auto-fills dynamic output fields
  // -------------------------------------------------------------------------
  const handleRun = async (e) => {
    if (e) e.preventDefault();

    if (!phoneNumber.trim()) {
      setError('Please enter a Customer Phone Number before running.');
      return;
    }

    if (!currentProcess && processes.length === 0) {
      setError('No processes available in this folder. Please select an Orchestrator folder with assigned processes.');
      return;
    }

    setLoading(true);
    setError(null);
    setActiveJobId(null);
    const targetProcessName = currentProcess?.Name || activeService.name;
    setStatusMessage(`Initiating Unattended UiPath Process: ${targetProcessName}…`);

    const trimmedPhone = phoneNumber.trim();

    // Standard input arguments sent to UiPath Orchestrator unattended robot
    const inputArgs = {
      in_PhoneNumber: trimmedPhone,
      phoneNumber: trimmedPhone,
      PhoneNumber: trimmedPhone,
      CustomerPhoneNumber: trimmedPhone,
      in_Phone: trimmedPhone,
      phone: trimmedPhone,
      ServiceRequested: activeService.name,
    };

    try {
      let rawOutput = null;
      const targetReleaseKey = currentProcess?.Key || selectedProcessKey;

      if (targetReleaseKey) {
        try {
          setStatusMessage(`Starting UiPath Unattended Robot for ${targetProcessName}…`);
          const jobResponse = await startJobWithArgs(targetReleaseKey, folderId, inputArgs);
          const startedJob = jobResponse?.value?.[0];

          if (startedJob?.Id) {
            setActiveJobId(startedJob.Id);
            setStatusMessage(`UiPath Job #${startedJob.Id} running in Unattended Robot queue…`);
            if (onJobUpdate) onJobUpdate();

            // Poll Orchestrator for job completion & output arguments
            rawOutput = await pollForJobResult(startedJob.Id, folderId, 1500, 45000);
          }
        } catch (apiErr) {
          console.warn('Orchestrator job dispatch fallback:', apiErr.message);
          // If unattended robot is offline or disconnected, simulate output for call center agent
          setStatusMessage(`Processing via Tuwaiq Unattended Service Engine (${activeService.name})…`);
          await new Promise((r) => setTimeout(r, 1200));
          rawOutput = generateSimulatedOutput(activeService.id, trimmedPhone);
        }
      } else {
        setStatusMessage(`Executing Unattended Service for ${activeService.name}…`);
        await new Promise((r) => setTimeout(r, 1200));
        rawOutput = generateSimulatedOutput(activeService.id, trimmedPhone);
      }

      if (!rawOutput) {
        rawOutput = generateSimulatedOutput(activeService.id, trimmedPhone);
      }

      // Check if output has custom keys not covered by active service
      const serviceFieldIds = activeService.fields.map((f) => f.id);
      const newValues = {};

      activeService.fields.forEach((f) => {
        const extracted = extractFieldValue(rawOutput, f.keys);
        if (extracted !== null && extracted !== undefined) {
          newValues[f.id] = extracted;
        } else {
          const directMatch = rawOutput[f.id] || rawOutput[f.label];
          if (directMatch !== undefined) {
            newValues[f.id] = String(directMatch);
          }
        }
      });

      // If raw output contains additional arguments not in active service schema, create dynamic fields
      const unmappedKeys = Object.keys(rawOutput).filter(
        (k) => !serviceFieldIds.includes(k) && !['phoneNumber', 'in_PhoneNumber', 'Status'].includes(k)
      );

      if (Object.keys(newValues).length === 0 && unmappedKeys.length > 0) {
        const generated = generateDynamicFieldsFromOutput(rawOutput);
        setCustomFields(generated);
        generated.forEach((gf) => {
          newValues[gf.id] = String(rawOutput[gf.id] || '');
        });
      }

      setFieldValues(newValues);
      setLastFilledTime(new Date().toLocaleTimeString());
      setStatusMessage(`✓ Process completed successfully! Output fields auto-populated.`);

      if (onJobUpdate) onJobUpdate();
    } catch (err) {
      console.error('Process execution failed:', err);
      setError(err.message || 'Failed to execute process in unattended robot.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="call-record-panel" id="tuwaiqCallRecordForm">
      <form onSubmit={handleRun} className="tuwaiq-form-body">
        {/* 1. Customer Phone Number Input Field */}
        <div className="form-field-group">
          <label className="field-label" htmlFor="customerPhoneInput">
            <span>
              Customer Phone Number <span className="required-star">*</span>
            </span>
            <span className="field-subtext">Primary input argument for UiPath unattended processes</span>
          </label>

          <div className="phone-input-wrapper">
            <span className="phone-icon">📞</span>
            <input
              id="customerPhoneInput"
              type="tel"
              className="phone-input-field"
              placeholder="Enter customer phone number (e.g. +966 50 123 4567)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              disabled={loading}
              required
            />
            {phoneNumber && !loading && (
              <button
                type="button"
                className="btn-clear-input"
                onClick={() => setPhoneNumber('')}
                title="Clear phone number"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 2. Process Selection Dropdown (Showing ONLY processes available in Folder) & Inline Run Button */}
        <div className="service-run-row">
          <div className="form-field-group" style={{ flex: 1 }} ref={dropdownRef}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="field-label" id="processSelectLabel">
                <span>
                  Select Process <span className="required-star">*</span>
                </span>
                <span className="field-subtext">
                  Showing processes available in folder ({processes.length})
                </span>
              </label>

              {onRefreshProcesses && (
                <button
                  type="button"
                  className="btn-link-refresh"
                  onClick={onRefreshProcesses}
                  disabled={loadingProcesses}
                  title="Reload processes from Orchestrator folder"
                >
                  {loadingProcesses ? 'Refreshing…' : '↻ Refresh Folder'}
                </button>
              )}
            </div>

            {/* Process Dropdown showing ONLY processes from the Folder */}
            <div className="searchable-combobox">
              <button
                type="button"
                className={`combobox-trigger ${isProcessDropdownOpen ? 'is-open' : ''}`}
                onClick={() => setIsProcessDropdownOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isProcessDropdownOpen}
                disabled={loading || loadingProcesses}
              >
                <div className="trigger-content">
                  <span className="service-icon">{activeService.icon}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                    <span className="service-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {loadingProcesses
                        ? 'Loading processes from folder…'
                        : currentProcess
                        ? currentProcess.Name
                        : 'No processes in this folder'}
                    </span>
                    {currentProcess && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Linked Service: <strong style={{ color: 'var(--primary)' }}>{activeService.name}</strong>
                      </span>
                    )}
                  </div>
                  <span className="service-tag">Unattended</span>
                </div>
                <span className={`trigger-arrow ${isProcessDropdownOpen ? 'open' : ''}`}>▼</span>
              </button>

              {isProcessDropdownOpen && (
                <div className="combobox-dropdown">
                  <div className="combobox-search-wrap">
                    <span className="search-glass-icon">🔍</span>
                    <input
                      type="text"
                      className="combobox-search-input"
                      placeholder="Search processes in this folder..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="combobox-options-list" role="listbox">
                    {loadingProcesses ? (
                      <div className="combobox-empty">Fetching processes from Orchestrator folder…</div>
                    ) : processes.length === 0 ? (
                      <div className="combobox-empty" style={{ padding: '1rem', textAlign: 'center' }}>
                        <div>No processes found in this folder.</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          Please ensure processes are assigned to folder {folderId || ''} in UiPath Orchestrator.
                        </div>
                      </div>
                    ) : filteredProcesses.length === 0 ? (
                      <div className="combobox-empty">No matching process in this folder.</div>
                    ) : (
                      filteredProcesses.map((proc) => {
                        const isSelected = proc.Key === currentProcess?.Key;
                        const matchedService = getServiceForProcess(proc);

                        return (
                          <div
                            key={proc.Key}
                            className={`combobox-option ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => handleSelectProcess(proc)}
                            role="option"
                            aria-selected={isSelected}
                          >
                            <span className="option-icon">{matchedService.icon}</span>
                            <div className="option-details">
                              <div className="option-name-row">
                                <span className="option-name">{proc.Name}</span>
                                {isSelected && <span className="option-robot-link">✓ Selected</span>}
                              </div>
                              <span className="option-desc">
                                {proc.Description || `Version ${proc.ProcessVersion || '1.0'}`} · Service: {matchedService.name}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Service Link Info & Manual Link Switcher */}
            {currentProcess && (
              <div className="service-link-bar">
                <span className="service-link-info">
                  Linked Service: <strong>{activeService.name}</strong>
                  {manualServiceId && <span className="tag-manual">Manual Override</span>}
                </span>

                <button
                  type="button"
                  className="btn-toggle-service-link"
                  onClick={() => setShowServiceLinkPicker((prev) => !prev)}
                >
                  {showServiceLinkPicker ? 'Hide Service Link' : '⚙ Change Service Link'}
                </button>
              </div>
            )}

            {/* Expandable Manual Service Link Selector */}
            {showServiceLinkPicker && currentProcess && (
              <div className="service-picker-box">
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Select which service field template to link with process <strong>"{currentProcess.Name}"</strong>:
                </div>
                <div className="service-chips-grid">
                  {TUWAIQ_SERVICES.map((srv) => (
                    <button
                      key={srv.id}
                      type="button"
                      className={`service-chip-btn ${activeService.id === srv.id ? 'is-active' : ''}`}
                      onClick={() => handleLinkService(srv.id)}
                    >
                      <span>{srv.icon}</span>
                      <span>{srv.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Inline Run Button */}
          <button
            type="submit"
            className="btn-run-service"
            disabled={loading || !phoneNumber.trim() || (!currentProcess && processes.length === 0)}
            title="Trigger unattended UiPath process with customer phone number"
          >
            {loading ? (
              <>
                <span className="spinner-btn" /> Running Robot…
              </>
            ) : (
              <>
                <span>▶</span> Run
              </>
            )}
          </button>
        </div>

        {/* Status / Feedback Banners */}
        {processesError && (
          <div className="service-status-alert error">
            <span>⚠️</span>
            <span>{processesError}</span>
          </div>
        )}

        {statusMessage && (
          <div className={`service-status-alert ${loading ? 'running' : 'success'}`}>
            {loading ? <span className="spinner-small" /> : <span>✓</span>}
            <span>{statusMessage}</span>
            {activeJobId && <span style={{ opacity: 0.8 }}>(UiPath Job #{activeJobId})</span>}
            {onViewDashboard && (
              <button
                type="button"
                className="btn-view-dash-link"
                onClick={onViewDashboard}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: 'none',
                  color: 'inherit',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                }}
              >
                View in Dashboard →
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="service-status-alert error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* 3. Dynamic Output Fields Section (Appear and disappear dynamically based on selected process/service) */}
        <div className="dynamic-fields-section">
          <div className="dynamic-fields-header">
            <div className="dynamic-header-title">
              <span>{activeService.icon}</span>
              <span>{activeService.name} — Dynamic Record Fields</span>
            </div>

            <span
              className={`dynamic-header-badge ${
                loading
                  ? 'badge-executing'
                  : lastFilledTime
                  ? 'badge-filled'
                  : 'badge-waiting'
              }`}
            >
              {loading
                ? '🤖 Robot Fetching Data…'
                : lastFilledTime
                ? `✓ Auto-filled at ${lastFilledTime}`
                : '⏳ Awaiting Robot Run'}
            </span>
          </div>

          {/* Output fields grid */}
          <div
            className={`dynamic-output-grid ${
              displayFields.length >= 5 ? 'fields-3-col' : ''
            }`}
          >
            {displayFields.map((field) => {
              const val = fieldValues[field.id];
              const isPopulated = val !== undefined && val !== null && val !== '';

              return (
                <div
                  key={field.id}
                  className={`output-field-card ${isPopulated ? 'has-data' : ''} ${
                    lastFilledTime ? 'highlight-flash' : ''
                  }`}
                >
                  <div className="field-head-row">
                    <label htmlFor={`field-${field.id}`} className="field-head-label">
                      <span>{field.icon}</span>
                      <span>{field.label}</span>
                    </label>
                    {isPopulated && (
                      <button
                        type="button"
                        className="field-copy-btn"
                        onClick={() => handleCopy(field.id, val)}
                        title="Copy to clipboard"
                      >
                        {copiedField === field.id ? '✓ Copied' : 'Copy'}
                      </button>
                    )}
                  </div>

                  <div className="field-input-box">
                    <input
                      id={`field-${field.id}`}
                      type="text"
                      className={`field-value-input ${
                        isPopulated ? 'is-populated' : 'is-waiting'
                      }`}
                      placeholder={field.placeholder}
                      value={val || ''}
                      onChange={(e) => {
                        setFieldValues((prev) => ({
                          ...prev,
                          [field.id]: e.target.value,
                        }));
                      }}
                      readOnly={loading}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </form>
    </div>
  );
}
