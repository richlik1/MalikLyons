import { useCallback, useRef, useState } from 'react';
import { ACCEPT, ImportError, importFile } from '../../core/importers';
import { requestPersistentStorage, saveImportedBook } from '../../core/storage/db';
import type { Book } from '../../core/types';
import { useSettings } from '../hooks/settings';
import { useToast } from '../hooks/toast';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

interface Failure {
  name: string;
  message: string;
  needsOcr: boolean;
}

/** File picker + extraction progress + error explanations for importing books. */
export function useImporter(onImported: (books: Book[], openDetails: boolean) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings } = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState<{ name: string; index: number; total: number; fraction: number; label: string } | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);

  const run = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      requestPersistentStorage();
      const added: Book[] = [];
      const failed: Failure[] = [];
      const category = settings.categories.includes('Other') ? 'Other' : settings.categories[0] ?? 'Other';
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBusy({ name: file.name, index: i, total: files.length, fraction: 0, label: 'Opening…' });
        try {
          const imported = await importFile(file, (fraction, label) => setBusy((b) => (b ? { ...b, fraction, label } : b)));
          setBusy((b) => (b ? { ...b, fraction: 1, label: 'Saving to your library…' } : b));
          added.push(await saveImportedBook(imported, { name: file.name, size: file.size, type: file.type, data: file }, category));
        } catch (e) {
          console.error(e);
          const err = e as Error;
          const quota = err?.name === 'QuotaExceededError';
          failed.push({
            name: file.name,
            needsOcr: e instanceof ImportError && e.kind === 'needs-ocr',
            message:
              e instanceof ImportError
                ? e.message
                : quota
                  ? 'Your device is out of storage space for this app. Delete some books or free up space, then try again.'
                  : `Something went wrong while reading this file (${err?.message ?? 'unknown error'}).`,
          });
        }
      }
      setBusy(null);
      if (failed.length) setFailures(failed);
      if (added.length) {
        if (added.length > 1) toast(`Added ${added.length} books to your library`);
        onImported(added, added.length === 1 && !failed.length);
      }
    },
    [onImported, settings.categories, toast],
  );

  const open = useCallback(() => inputRef.current?.click(), []);

  const ui = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          run(files);
        }}
      />
      {busy && (
        <div className="scrim">
          <div className="sheet" role="dialog" aria-label="Importing">
            <div className="progress-modal">
              <div className="spinner" />
              <h3 style={{ margin: '0 0 4px', fontFamily: 'var(--serif)' }}>
                {busy.total > 1 ? `Importing ${busy.index + 1} of ${busy.total}` : 'Preparing your book'}
              </h3>
              <div className="muted small" style={{ wordBreak: 'break-word' }}>
                {busy.name}
              </div>
              <div className="small" style={{ marginTop: 10, color: 'var(--text-2)' }}>
                {busy.label}
              </div>
              <div className="bar">
                <i style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
              </div>
              <p className="muted small" style={{ marginTop: 14 }}>
                Everything happens on this device. Your file is never uploaded.
              </p>
            </div>
          </div>
        </div>
      )}
      {failures.length > 0 && (
        <Sheet title={failures.some((f) => f.needsOcr) ? 'This PDF needs OCR' : "Couldn't import"} onClose={() => setFailures([])}>
          {failures.map((f) => (
            <div key={f.name} className="banner warn">
              <span className="icon-wrap">
                <Icon name="info" />
              </span>
              <div className="banner-body">
                <strong style={{ wordBreak: 'break-word' }}>{f.name}</strong>
                <div style={{ marginTop: 4 }}>{f.message}</div>
              </div>
            </div>
          ))}
          <button className="btn btn-primary btn-block" onClick={() => setFailures([])}>
            OK
          </button>
        </Sheet>
      )}
    </>
  );

  return { open, ui, run };
}
