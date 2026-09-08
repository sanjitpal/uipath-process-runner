import { useState, useEffect, useMemo } from 'react';
import { startJobWithArgs, pollForJobResult } from '../services/uiPathApi';
import './FullNameForm.css';

// Predefined process schemas matching the user's requirements
export const PROCESS_SCHEMAS = {
  USER_DETAILS: {
    id: 'USER_DETAILS',
    title: 'Fetch User Details',
    badge: 'User Details',
    description: 'Retrieve Customer Name, Email, and Expenses using Phone Number',
    fields: [
      {
        id: 'customerName',
        label: 'Customer Name',
        keys: [
          'CustomerName',
          'out_CustomerName',
          'Customer Name',
          'customer_name',
          'customerName',
          'Customer_Name',
          'Name',
          'out_Name',
          'name',
        ],
        icon: '👤',
        placeholder: 'e.g. Jane Doe',
      },
      {
        id: 'customerEmail',
        label: 'Customer Email',
        keys: [
          'CustomerEmail',
          'out_CustomerEmail',
          'Customer Email',
          'customer_email',
          'customerEmail',
          'Customer_Email',
          'Email',
          'out_Email',
          'email',
        ],
        icon: '✉️',
        placeholder: 'e.g. jane.doe@example.com',
      },
      {
        id: 'customerExpenses',
        label: 'Customer Expenses',
        keys: [
          'CustomerExpenses',
          'out_CustomerExpenses',
          'Customer Expenses',
          'customer_expenses',
          'customerExpenses',
          'Customer_Expenses',
          'Expenses',
          'out_Expenses',
          'expenses',
        ],
        icon: '💳',
        placeholder: 'e.g. $1,250.00',
      },
    ],
  },
  ORDER_DETAILS: {
    id: 'ORDER_DETAILS',
    title: 'Fetch Order Details',
    badge: 'Order Details',
    description: 'Retrieve Customer Name, Email, and Order Amount using Phone Number',
    fields: [
      {
        id: 'customerName',
        label: 'Customer Name',
        keys: [
          'CustomerName',
          'out_CustomerName',
          'Customer Name',
          'customer_name',
          'customerName',
          'Customer_Name',
          'Name',
          'out_Name',
          'name',
        ],
        icon: '👤',
        placeholder: 'e.g. Jane Doe',
      },
      {
        id: 'customerEmail',
        label: 'Customer Email',
        keys: [
          'CustomerEmail',
          'out_CustomerEmail',
          'Customer Email',
          'customer_email',
          'customerEmail',
          'Customer_Email',
          'Email',
          'out_Email',
          'email',
        ],
        icon: '✉️',
        placeholder: 'e.g. jane.doe@example.com',
      },
      {
        id: 'orderAmount',
        label: 'Order Amount',
        keys: [
          'OrderAmount',
          'out_OrderAmount',
          'Order Amount',
          'order_amount',
          'orderAmount',
          'Order_Amount',
          'Amount',
          'out_Amount',
          'amount',
          'TotalAmount',
          'total_amount',
          'OrderTotal',
        ],
        icon: '📦',
        placeholder: 'e.g. $349.99',
      },
    ],
  },
};

// Helper to extract a value from UiPath output arguments by checking candidate keys
function extractFieldValue(result, keys) {
  if (!result || typeof result !== 'object') return null;

  // 1. Direct match
  for (const k of keys) {
    if (result[k] !== undefined && result[k] !== null && result[k] !== '') {
      return result[k];
    }
  }

  // 2. Case-insensitive & normalized match (strip spaces and underscores)
  const lowerMap = {};
  for (const [key, val] of Object.entries(result)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    lowerMap[norm] = val;
  }

  for (const k of keys) {
    const normKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lowerMap[normKey] !== undefined && lowerMap[normKey] !== null && lowerMap[normKey] !== '') {
      return lowerMap[normKey];
    }
  }

  return null;
}

function FullNameForm({
  releaseKey,
  selectedProcessKey,
  onSelectProcessKey,
  processes = [],
  folderId,
  onJobUpdate,
}) {
  const currentReleaseKey = selectedProcessKey || releaseKey || '';

  // Active process schema mode: 'USER_DETAILS' or 'ORDER_DETAILS'
  const [schemaMode, setSchemaMode] = useState('USER_DETAILS');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [error, setError] = useState(null);

  // Auto-detect schema mode when process selection changes
  useEffect(() => {
    if (!currentReleaseKey || !processes.length) return;
    const selectedProc = processes.find((p) => p.Key === currentReleaseKey);
    if (!selectedProc) return;

    const name = selectedProc.Name.toLowerCase();
    if (name.includes('order')) {
      setSchemaMode('ORDER_DETAILS');
    } else if (name.includes('user')) {
      setSchemaMode('USER_DETAILS');
    }
  }, [currentReleaseKey, processes]);

  // When switching schema manually, if an exact matching process exists in the folder, auto-select it
  const handleSchemaChange = (newMode) => {
    setSchemaMode(newMode);
    setError(null);
    setResult(null);

    if (onSelectProcessKey && processes.length > 0) {
      const targetTerm = newMode === 'ORDER_DETAILS' ? 'order' : 'user';
      const matchingProc = processes.find((p) => p.Name.toLowerCase().includes(targetTerm));
      if (matchingProc) {
        onSelectProcessKey(matchingProc.Key);
      }
    }
  };

  const activeSchema = PROCESS_SCHEMAS[schemaMode] || PROCESS_SCHEMAS.USER_DETAILS;

  // Compile recognized keys for the active schema to identify any extra unmapped arguments
  const recognizedKeys = useMemo(() => {
    return activeSchema.fields.flatMap((f) => f.keys);
  }, [activeSchema]);

  const additionalOutputs = useMemo(() => {
    if (!result || typeof result !== 'object') return [];
    const recognizedSet = new Set(
      recognizedKeys.map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );

    return Object.entries(result).filter(([key]) => {
      const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !recognizedSet.has(norm);
    });
  }, [result, recognizedKeys]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!currentReleaseKey) {
      setError('Please select a UiPath process from the dropdown to run.');
      return;
    }

    if (!phoneNumber.trim()) {
      setError('Please enter a valid phone number.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setActiveJobId(null);
    setStatusMessage('Initiating job in UiPath Orchestrator…');

    try {
      // Pass multiple common parameter variations so the workflow binds successfully
      const inputArgs = {
        in_PhoneNumber: phoneNumber.trim(),
        phoneNumber: phoneNumber.trim(),
        PhoneNumber: phoneNumber.trim(),
        in_Phone: phoneNumber.trim(),
        phone: phoneNumber.trim(),
      };

      const jobData = await startJobWithArgs(currentReleaseKey, folderId, inputArgs);
      const jobId = jobData.value?.[0]?.Id;

      if (!jobId) {
        throw new Error('No job ID returned from Orchestrator');
      }

      setActiveJobId(jobId);
      setStatusMessage(`Job #${jobId} running in UiPath… polling for output arguments…`);

      if (onJobUpdate) {
        onJobUpdate();
      }

      // Poll for job completion
      const jobResult = await pollForJobResult(jobId, folderId);
      setResult(jobResult);
      setStatusMessage(`Job #${jobId} completed successfully!`);

      if (onJobUpdate) {
        onJobUpdate();
      }
    } catch (err) {
      console.error('Job execution error:', err);
      setError(err.message || 'Failed to execute process in UiPath');
      setStatusMessage('');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setPhoneNumber('');
    setResult(null);
    setError(null);
    setStatusMessage('');
    setActiveJobId(null);
  };

  return (
    <div className="full-name-form-panel">
      {/* Header with Title and Mode Switcher */}
      <div className="form-header">
        <div className="form-title-wrap">
          <h2>
            <span className="idx">4</span> Process Execution Form
          </h2>
          <span className="form-subtitle">
            Enter a phone number to run automated data retrieval via UiPath
          </span>
        </div>

        {/* Process Schema Mode Tabs */}
        <div className="schema-tabs" role="tablist">
          <button
            type="button"
            className={`schema-tab-btn ${schemaMode === 'USER_DETAILS' ? 'active' : ''}`}
            onClick={() => handleSchemaChange('USER_DETAILS')}
            disabled={loading}
          >
            <span className="tab-icon">👤</span>
            <span className="tab-text">Fetch User Details</span>
          </button>
          <button
            type="button"
            className={`schema-tab-btn ${schemaMode === 'ORDER_DETAILS' ? 'active' : ''}`}
            onClick={() => handleSchemaChange('ORDER_DETAILS')}
            disabled={loading}
          >
            <span className="tab-icon">📦</span>
            <span className="tab-text">Fetch Order Details</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="full-name-form">
        {/* Controls Row: Process Selector + Phone Number Input */}
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="processSelect">
              UiPath Process (Release):
              <span className="field-required">*</span>
            </label>
            <select
              id="processSelect"
              value={currentReleaseKey}
              onChange={(e) => onSelectProcessKey && onSelectProcessKey(e.target.value)}
              disabled={loading || processes.length === 0}
            >
              <option value="">
                {processes.length === 0 ? '-- No processes in folder --' : '-- Select a process --'}
              </option>
              {processes.map((proc) => (
                <option key={proc.Key} value={proc.Key}>
                  {proc.Name} (v{proc.ProcessVersion})
                </option>
              ))}
            </select>
            {processes.length === 0 && (
              <p className="field-hint muted">
                No processes available in this folder. Make sure processes are assigned.
              </p>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="phoneNumber">
              Input Phone Number:
              <span className="field-required">*</span>
            </label>
            <div className="input-with-icon">
              <span className="input-icon">📞</span>
              <input
                type="tel"
                id="phoneNumber"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Enter customer phone (e.g. +1 555-0199)"
                disabled={loading}
                required
              />
            </div>
            <p className="field-hint">Passed to UiPath as input parameter (in_PhoneNumber)</p>
          </div>
        </div>

        {/* Action Button Bar */}
        <div className="form-actions-row">
          <button
            type="submit"
            className="btn btn-primary btn-run-process"
            disabled={loading || !currentReleaseKey || !phoneNumber.trim()}
          >
            {loading ? (
              <>
                <span className="spinner" />
                <span>Running Job…</span>
              </>
            ) : (
              <>
                <span>▶ Run {activeSchema.title}</span>
              </>
            )}
          </button>

          {(result || error || phoneNumber) && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleReset}
              disabled={loading}
            >
              Clear Form
            </button>
          )}
        </div>

        {/* Live Status or Error Banners */}
        {loading && statusMessage && (
          <div className="form-status-banner">
            <span className="spinner-small" />
            <span>{statusMessage}</span>
          </div>
        )}

        {error && (
          <div className="form-message form-error" role="alert">
            <strong>Execution Error: </strong>
            <span>{error}</span>
          </div>
        )}

        {/* Dynamic Output Fields Section */}
        <div className="output-section">
          <div className="output-section-header">
            <div className="output-section-title">
              <span>Expected Output Fields</span>
              <span className="badge-mode">{activeSchema.badge}</span>
            </div>
            {result && activeJobId && (
              <span className="badge-success">
                ✓ Retrieved from Job #{activeJobId}
              </span>
            )}
          </div>

          <div className="dynamic-output-grid">
            {activeSchema.fields.map((field) => {
              const val = result ? extractFieldValue(result, field.keys) : null;
              const hasValue = val !== null && val !== undefined;

              return (
                <div
                  key={field.id}
                  className={`output-card ${hasValue ? 'has-value' : 'awaiting'}`}
                >
                  <div className="output-card-head">
                    <span className="output-card-icon">{field.icon}</span>
                    <span className="output-card-label">{field.label}</span>
                    {hasValue && <span className="output-badge-ready">Received</span>}
                  </div>

                  <div className="output-card-value">
                    {hasValue ? (
                      <span className="value-text">
                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                      </span>
                    ) : (
                      <span className="placeholder-text">
                        {loading ? 'Processing in UiPath…' : field.placeholder}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Any additional output arguments from Orchestrator not matched to the 3 main fields */}
          {result && additionalOutputs.length > 0 && (
            <div className="additional-output-box">
              <div className="additional-output-title">Additional Output Arguments:</div>
              <div className="additional-output-list">
                {additionalOutputs.map(([k, v]) => (
                  <div key={k} className="additional-output-row">
                    <span className="key-name">{k}:</span>
                    <span className="key-val">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

export default FullNameForm;
