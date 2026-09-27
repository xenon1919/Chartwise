import { useEffect, useState } from 'react';
import { Modal } from './AddDataModal.jsx';
import { DataTable } from './AnswerCard.jsx';
import { api } from '../../lib/api.js';

export default function PreviewModal({ datasetId, table, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.preview(datasetId, table).then(setData).catch((e) => setError(e.message));
  }, [datasetId, table]);

  return (
    <Modal title={`Preview · ${table}`} onClose={onClose} wide>
      <div className="modal-body">
        {error && <p className="form-error">{error}</p>}
        {!data && !error && <div className="preview-loading"><span className="spinner" /></div>}
        {data && (
          <>
            <p className="preview-note">First {data.row_count} rows</p>
            <DataTable columns={data.columns} rows={data.rows} />
          </>
        )}
      </div>
    </Modal>
  );
}
