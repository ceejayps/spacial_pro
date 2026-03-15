import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { ScanRecord } from './scanService';

function sanitizeFileBaseName(nameValue: string) {
  const value = String(nameValue || '').trim();

  if (!value) {
    return 'spacial-pro-scan';
  }

  return value
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

function extensionFromPath(pathValue: string) {
  const value = String(pathValue || '').trim().toLowerCase();

  if (value.endsWith('.glb')) {
    return 'glb';
  }

  if (value.endsWith('.gltf')) {
    return 'gltf';
  }

  if (value.endsWith('.obj')) {
    return 'obj';
  }

  return '';
}

function inferExtension(scan: ScanRecord) {
  const explicit = String(scan.modelFormat || '').trim().toLowerCase();

  if (explicit === 'glb' || explicit === 'gltf' || explicit === 'obj') {
    return explicit;
  }

  const fromFilename = extensionFromPath(scan.originalFilename);

  if (fromFilename) {
    return fromFilename;
  }

  const fromModelPath = extensionFromPath(scan.modelPath);

  if (fromModelPath) {
    return fromModelPath;
  }

  const fromModelUrl = extensionFromPath(scan.modelUrl);

  if (fromModelUrl) {
    return fromModelUrl;
  }

  const fromDownloadUrl = extensionFromPath(scan.fileDownloadUrl);

  if (fromDownloadUrl) {
    return fromDownloadUrl;
  }

  return 'glb';
}

function buildDownloadName(scan: ScanRecord) {
  return `${sanitizeFileBaseName(scan.title)}.${inferExtension(scan)}`;
}

function toFileUrl(pathValue: string) {
  const value = String(pathValue || '').trim();

  if (!value) {
    return '';
  }

  if (value.startsWith('file://') || value.startsWith('content://')) {
    return value;
  }

  if (value.startsWith('/')) {
    return `file://${value}`;
  }

  return '';
}

function isLocalFileUrl(value: string) {
  return /^(file|content|capacitor):\/\//i.test(String(value || '').trim());
}

function resolveNativeShareUrl(scan: ScanRecord) {
  const fileUrl = toFileUrl(scan.modelPath);

  if (fileUrl) {
    return fileUrl;
  }

  if (isLocalFileUrl(scan.modelUrl)) {
    return scan.modelUrl;
  }

  if (isLocalFileUrl(scan.fileDownloadUrl)) {
    return scan.fileDownloadUrl;
  }

  return '';
}

function resolveWebDownloadUrl(scan: ScanRecord) {
  const candidates = [scan.fileDownloadUrl, scan.modelUrl, scan.modelPath];

  for (const candidate of candidates) {
    const value = String(candidate || '').trim();

    if (!value || isLocalFileUrl(value)) {
      continue;
    }

    return value;
  }

  return '';
}

export function getExportActionLabel() {
  return Capacitor.isNativePlatform() ? 'Share' : 'Export';
}

export async function exportModelToFiles(scan: ScanRecord) {
  if (!scan) {
    throw new Error('Scan not found.');
  }

  const downloadName = buildDownloadName(scan);

  if (Capacitor.isNativePlatform()) {
    const shareUrl = resolveNativeShareUrl(scan);

    if (!shareUrl) {
      throw new Error('No local file URL is available to share on this device.');
    }

    await Share.share({
      title: `Share ${scan.title || 'scan'}`,
      text: 'Share this 3D scan file.',
      url: shareUrl,
      dialogTitle: 'Share scan',
    });

    return;
  }

  const downloadUrl = resolveWebDownloadUrl(scan);

  if (!downloadUrl) {
    throw new Error('No downloadable model file is available for export.');
  }

  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = downloadName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
