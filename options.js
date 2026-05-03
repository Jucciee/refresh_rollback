// Load settings
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      document.getElementById('maxStates').value = result.settings.maxStates;
      document.getElementById('filterMode').value = result.settings.filterMode;
      document.getElementById('filterSites').value = result.settings.filterSites.join('\n');
    }
  });
});

// Save settings
document.getElementById('saveBtn').addEventListener('click', () => {
  const maxStates = parseInt(document.getElementById('maxStates').value, 10);
  const filterMode = document.getElementById('filterMode').value;
  const filterSitesRaw = document.getElementById('filterSites').value;
  
  const filterSites = filterSitesRaw.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  chrome.storage.local.set({
    settings: {
      maxStates: isNaN(maxStates) ? 5 : maxStates,
      filterMode: filterMode,
      filterSites: filterSites
    }
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Settings saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
