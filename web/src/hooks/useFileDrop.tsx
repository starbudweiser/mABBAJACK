import React, { useCallback, useRef, useState } from 'react';
import { useMabbajack } from '../state/mabbajack';

/** Dépôt d'un .wabbajack sur toute la fenêtre : props à poser sur le conteneur + état de l'overlay. */
export function useFileDrop() {
  const { loadWabbajackFile, addLog } = useMabbajack();
  const [isDragging, setIsDragging] = useState(false);
  const counter = useRef(0);

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    counter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  }, []);
  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    counter.current--;
    if (counter.current === 0) setIsDragging(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    counter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const name = file.name.toLowerCase();
    if (name.endsWith('.wabbajack') || name.endsWith('.zip')) loadWabbajackFile(file);
    else addLog('warn', `Fichier non reconnu : "${file.name}". Seuls les fichiers .wabbajack sont acceptés.`);
  }, [loadWabbajackFile, addLog]);

  return { isDragging, dropProps: { onDragEnter, onDragLeave, onDragOver, onDrop } };
}
