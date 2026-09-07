import { useState } from 'react';
import { startJobWithArgs, pollForJobResult } from '../services/uiPathApi';
import './FullNameForm.css';

function FullNameForm({ releaseKey, folderId }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!releaseKey) {
      setError('Please select a process from the dropdown above.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Start the job with input arguments
      const jobData = await startJobWithArgs(
        releaseKey,
        folderId,
        { in_FirstName: firstName, in_LastName: lastName }
      );

      // Get the job ID from the response
      const jobId = jobData.value?.[0]?.Id;
      if (!jobId) {
        throw new Error('No job ID returned from Orchestrator');
      }

      // Poll for the job result
      const jobResult = await pollForJobResult(jobId, folderId);
      setResult(jobResult);
    } catch (err) {
      setError(err.message || 'Failed to execute process');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="full-name-form-panel">
      <div className="form-header">
        <h2>
          <span className="idx">4</span> Full Name Process
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="full-name-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="firstName">First Name</label>
            <input
              type="text"
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Enter first name"
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="lastName">Last Name</label>
            <input
              type="text"
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Enter last name"
              disabled={loading}
              required
            />
          </div>
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-full"
          disabled={loading || !firstName || !lastName}
        >
          {loading ? 'Processing…' : 'Full Name'}
        </button>

        {error && (
          <div className="form-message form-error">{error}</div>
        )}

        {result && (
          <div className="form-result">
            <div className="result-title">Process Output</div>
            <div className="result-content">
              {Object.entries(result).map(([key, value]) => (
                <div key={key} className="result-row">
                  <span className="result-key">{key}:</span>
                  <span className="result-value">
                    {typeof value === 'object'
                      ? JSON.stringify(value, null, 2)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default FullNameForm;
