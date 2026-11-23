'use strict';

(() => {
  const exportButton = document.getElementById('export-backup');
  const importButton = document.getElementById('import-backup');
  const picker = document.getElementById('backup-file');
  const status = document.getElementById('backup-status');
  async function work(action) {
    exportButton.disabled = importButton.disabled = true;
    try { await action(); }
    catch (error) { status.textContent = 'Backup could not finish. ' + (error.message || 'Please try again.'); }
    finally { exportButton.disabled = importButton.disabled = false; }
  }
  exportButton.onclick = () => work(async () => {
    status.textContent = 'Preparing your study backup…';
    const backup = await storageService.exportBackup();
    const blob = new Blob([JSON.stringify(backup)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'AbiVerse-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    status.textContent = 'Study backup ready to download.';
  });
  importButton.onclick = () => picker.click();
  picker.onchange = () => work(async () => {
    const file = picker.files[0];
    if (!file) return;
    picker.value = '';
    status.textContent = 'Importing study records…';
    const input = JSON.parse(await file.text());
    await storageService.importBackup(input);
    status.textContent = 'Backup imported. Existing records were kept.';
  });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        status.textContent = 'Offline launch is unavailable in this browser.';
      });
    });
  }
})();
