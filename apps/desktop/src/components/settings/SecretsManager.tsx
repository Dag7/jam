import React, { useState, useEffect } from 'react';

const SECRET_TYPES = [
  { id: 'api-key', label: 'API Key' },
  { id: 'token', label: 'Token' },
  { id: 'connection-string', label: 'Connection String' },
  { id: 'credential', label: 'Credential' },
];

interface SecretInfo {
  id: string;
  name: string;
  type: string;
}

export const SecretsManager: React.FC = () => {
  const [secrets, setSecrets] = useState<SecretInfo[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('api-key');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadSecrets = () => {
    window.jam.secrets.list().then(setSecrets);
  };

  useEffect(loadSecrets, []);

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setName('');
    setType('api-key');
    setValue('');
  };

  const handleSave = async () => {
    if (!name.trim() || !value.trim()) return;
    setSaving(true);

    const id = editId ?? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await window.jam.secrets.set(id, name.trim(), type, value.trim());
    loadSecrets();
    resetForm();
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await window.jam.secrets.delete(id);
    setConfirmDelete(null);
    loadSecrets();
  };

  const handleEdit = (secret: SecretInfo) => {
    setEditId(secret.id);
    setName(secret.name);
    setType(secret.type);
    setValue('');
    setShowForm(true);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Secrets Vault
        </h3>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            + Add Secret
          </button>
        )}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Secrets are encrypted locally and injected as environment variables into agent processes.
        Values are never shown in the UI or passed through chat.
      </p>

      {/* Secret list */}
      {secrets.length > 0 && (
        <div className="space-y-2 mb-3">
          {secrets.map((secret) => (
            <div
              key={secret.id}
              className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 border border-zinc-700/50 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-zinc-200 truncate">{secret.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400 shrink-0">
                  {secret.type}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  onClick={() => handleEdit(secret)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  edit
                </button>
                {confirmDelete === secret.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(secret.id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(secret.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {secrets.length === 0 && !showForm && (
        <div className="text-xs text-zinc-600 py-4 text-center">
          No secrets configured. Add secrets to make them available to agents.
        </div>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="space-y-3 p-3 bg-zinc-800/30 border border-zinc-700/50 rounded-lg">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., GitHub Token"
              disabled={!!editId}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            >
              {SECRET_TYPES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              {editId ? 'New Value' : 'Value'}
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={editId ? 'Enter new value to update' : 'Enter secret value'}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim() || !value.trim()}
              className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : editId ? 'Update Secret' : 'Add Secret'}
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
